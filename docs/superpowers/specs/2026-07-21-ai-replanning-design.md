# Plan B: AI-Powered Replanning via Voice — Design

## Purpose

Today, every capture (web voice/text, or Telegram voice/text since Plan A) goes through
exactly one AI step (`extract_tasks`) whose only capability is extracting brand-new
tasks from an utterance. There is no way to say "move my dentist appointment to
Thursday at 3pm" and have it find and reschedule the existing task — the AI would
instead try (and most likely fail) to extract a new task called something like "move
dentist appointment," creating clutter instead of doing what was meant.

This plan adds automatic intent detection to the existing capture pipeline: before
falling through to today's "extract new tasks" behavior, a lightweight AI classification
step checks whether the utterance is referring to an existing task for rescheduling. If
so, and a confident match is found among the user's real tasks, it's rescheduled
directly (same effect as using `EditTaskSheet`, or the new drag-to-reschedule on the
Day timeline). If the utterance is clearly a reschedule request but no task matches
confidently, the user is told nothing was found. If it isn't a reschedule request at
all, nothing changes — today's create-flow runs exactly as before.

## Current state (baseline)

- `extract_tasks(raw_text: str, today: date) -> list[ExtractedTask]`
  (`backend/app/ai/triage.py`) — OpenAI `gpt-4o-mini`, forced single-function tool call,
  extracts only brand-new tasks (`title`, `priority`, `deadline`, `scheduled_at`). No
  intent classification exists anywhere in the codebase; this is the only AI step any
  capture goes through.
- `process_capture(user, raw_text, source, db) -> list[Task]`
  (`backend/app/captures/service.py`, added in Plan A) is the single entry point both
  the web app (`POST /captures`) and the Telegram bot (`handle_capture_message`) call.
  It always: creates a `Capture` row → calls `extract_tasks` → creates draft `Task` rows
  from every extracted item → notifies Telegram if `source == "telegram"`.
- `PATCH /tasks/{id}` (`backend/app/tasks/router.py`) already accepts partial updates
  to `title`, `priority`, `deadline`, `status`, `scheduled_at`, and already
  automatically calls `_sync_task_google` afterward — Google Calendar/Tasks sync on
  reschedule is already automatic and requires no new plumbing.
- No fuzzy/semantic task-matching exists anywhere in the backend — the only existing
  lookup is `_get_owned_task`, an exact-ID lookup.
- Frontend capture flow (`frontend/lib/capture-flow-context.tsx`) is a state machine:
  `CaptureStage = "closed" | "choice" | "voice" | "text" | "processing" | "success" |
  "empty" | "error"`, one view component per stage, `submitCapture(rawText)` drives the
  `"processing"` → (`"success"` | `"empty"` | `"error"`) transition based on the
  `POST /captures` response.

## Scope boundaries

**In scope:** automatic reschedule-intent detection on every capture (web + Telegram,
voice + text); matching against the user's own **confirmed or done** tasks only (drafts
excluded — a draft is edited/confirmed directly in Inbox, not retargeted by voice);
changing only `deadline`/`scheduled_at` on a match (title, priority, status untouched);
a "no matching task found" outcome distinct from "no new tasks extracted"; new frontend
states (`"rescheduled"`, `"not_found"`) and matching views; new Telegram reply messages
for both outcomes.

**Out of scope:** cancelling/deleting a task by voice (a different feature — this plan
is reschedule-only, matching the literal request). Changing anything other than
date/time (title edits, priority changes) via a voice command. Matching against draft or
rejected tasks. Multi-task utterances that mix a reschedule reference with new-task
creation in the same sentence (treated as a single intent — see Architecture). An
"undo" affordance for an accidental reschedule (the task can already be corrected via
`EditTaskSheet` or another voice command — no new undo mechanism is being built).

## Architecture

### New AI matching step

New `backend/app/ai/replan.py`:

```python
def find_reschedule_target(
    raw_text: str, today: date, candidate_tasks: list[CandidateTask]
) -> ReplanResult: ...
```

`CandidateTask` is a small, purpose-built shape (`id`, `title`, `deadline`,
`scheduled_at`) — not the full `Task` model — built from a fresh query in the service
layer (`status IN ("confirmed", "done")`, capped and ordered by recency to keep the
prompt bounded for long-lived accounts) each time a capture is processed.

`ReplanResult` is a tagged result with three outcomes, mirrored as three tools offered
to the model in one forced (`tool_choice: "required"`) call, letting the model itself
pick which applies rather than requiring a separate classification pass:
- `reschedule_task(task_id, new_deadline?, new_scheduled_at?)` — a confident match,
  reusing the same weekday-reference-table + date-rule prompt language
  `extract_tasks` already uses for interpreting relative dates, so "Thursday" resolves
  identically in both flows.
- `no_matching_task` — the utterance is clearly asking to move something, but nothing
  in `candidate_tasks` matches confidently enough.
- `not_a_reschedule` — the utterance isn't referring to an existing task at all (the
  common case — most captures are new tasks, and this is the signal to fall through to
  today's unchanged `extract_tasks` behavior).

This is a genuinely separate, smaller AI call from `extract_tasks` (not a merged
single-call design) — deliberately, to leave `extract_tasks` and its existing tests
completely untouched, keeping this plan's blast radius confined to new code plus the
one call site that decides which path to take. The cost/latency of a second small model
call per capture is judged an acceptable tradeoff for that isolation; flagged as a
judgment call below.

### `process_capture` gains a branch

`process_capture` (`backend/app/captures/service.py`) still creates one `Capture` row
per incoming utterance (audit trail unchanged), but now calls `find_reschedule_target`
first:

- **`reschedule_task`**: applies the update directly to the matched task (`deadline`/
  `scheduled_at` only — same mechanism `PATCH /tasks/{id}` uses, including the existing
  automatic `_sync_task_google` call), sets the `Capture.status` to a new `"rescheduled"`
  value (distinct from `"complete"`/`"failed"`, useful for later audit/analytics),
  notifies Telegram (a new, distinct confirmation message — no approve/reject buttons,
  since the change is already applied) if `source == "telegram"`, and returns a
  discriminated result carrying the updated task.
- **`no_matching_task`**: no task is touched; `Capture.status` becomes `"no_match"`;
  Telegram gets a distinct "not found" reply if `source == "telegram"`; returns a
  discriminated result with no task/tasks.
- **`not_a_reschedule`**: identical to today's behavior — falls through to
  `extract_tasks` and everything downstream of it, byte-for-byte unchanged.

`process_capture`'s return type changes from a plain `list[Task]` to a small
discriminated result (`kind: "created" | "rescheduled" | "not_found"`, plus the
relevant payload) — this is an intentional breaking change to what both callers
(`POST /captures`, `handle_capture_message`) receive, coordinated within this same plan
(there are no other/external consumers of `POST /captures` to break).

### API contract change

`POST /captures`'s `response_model` changes from `list[TaskOut]` to a new schema
expressing all three outcomes (`kind` + `tasks: list[TaskOut]` for the created case +
`task: Optional[TaskOut]` for the rescheduled case). This is a deliberate, coordinated
break of the existing wire format — the frontend's `submitCapture` is updated in the
same plan to branch on `kind` instead of assuming an array of created tasks.

### Frontend changes

`CaptureStage` gains two values: `"rescheduled"` and `"not_found"` (kept distinct from
the existing `"success"`/`"empty"`, matching the established one-stage-per-outcome
pattern rather than overloading an existing stage with a flag). Two new view
components, `RescheduledView` and `NotFoundView`, follow the exact structure of the
existing `SuccessView`/`EmptyResultView` — `RescheduledView` shows the task's new
title/date/time and a "Переглянути в Задачах" action (navigates to `/tasks`, the
natural place to see a rescheduled item, as opposed to `/inbox` which is for
unconfirmed drafts); `NotFoundView` reuses the existing `.empty-block` warning-icon
pattern with copy explaining nothing matched. `submitCapture` branches on the API
response's `kind` to set the corresponding stage.

## Data flow

**Reschedule:** "перенеси стоматолога на четвер" (web voice, or Telegram voice/text) →
transcribe (if voice, unchanged) → `process_capture(user, text, source, db)` →
`find_reschedule_target` matches against the user's confirmed/done tasks → matched task
updated (`deadline`/`scheduled_at`), Google-synced automatically → web gets
`{kind: "rescheduled", task}` and shows `RescheduledView`; Telegram gets a confirmation
message.

**No match:** "перенеси зустріч з інопланетянами на четвер" (nothing matches) → same
classification step returns `no_matching_task` → web gets `{kind: "not_found"}` and
shows `NotFoundView`; Telegram gets a "not found" reply.

**Ordinary creation (unchanged):** "купити молоко і подзвонити мамі" → classification
step returns `not_a_reschedule` → falls through to `extract_tasks`, exactly as today →
web gets `{kind: "created", tasks: [...]}` and shows the existing `SuccessView`/
`EmptyResultView`; Telegram gets the existing approve/reject-button notification (only
when `source == "telegram"`, per Plan A) or the existing empty-result reply.

## Error handling

| Failure point | Response |
|---|---|
| `find_reschedule_target` raises (AI call fails) | Treated the same as today's `extract_tasks`-failure path — `CaptureProcessingError`, `Capture.status = "failed"`, same existing "Не вдалося обробити" message on both surfaces. No new error category needed; a failure at the classification step is indistinguishable from the existing triage-failure case from the user's perspective. |
| `extract_tasks` raises (fallback path, `not_a_reschedule`) | Unchanged from today. |
| Matched task's Google sync fails | Unchanged from today's existing graceful-degradation pattern (`_sync_task_google` already logs and swallows its own failures — the task itself still saves/reschedules regardless). |

## Testing / verification approach

Backend: real `pytest` coverage, matching the existing convention — `find_reschedule_target`
tested directly (mocked OpenAI call) for all three tool outcomes; `process_capture`
tested for all three branches (reschedule applies the update + syncs + notifies-if-telegram;
no-match touches nothing + notifies-if-telegram; not-a-reschedule falls through
unchanged — regression-covering that Plan A's and the pre-Plan-A create-flow tests still
pass); `POST /captures`'s new response shape tested for all three `kind` values;
Telegram handler tests for the two new reply paths.

Frontend: no test framework (matches this project's established convention) —
`npm run build`/`npm run lint` clean plus a browser walkthrough of both new stages
(reschedule a real task by voice/text, attempt to reschedule something that doesn't
exist, confirm the existing create-flow still works unchanged).

## Open judgment calls made in this spec (flagged, not blocking)

- Two-call design (separate classification step, not merged into `extract_tasks`'s own
  tool schema) trades a small amount of extra latency/cost per capture for leaving the
  existing, tested `extract_tasks` function and its call sites completely untouched.
- Candidate-task list is capped/bounded (exact number to be fixed in the plan, likely
  ~100-200 ordered by recency) rather than the user's entire task history, to keep the
  classification prompt a reasonable size for long-lived accounts — not explicitly
  specified by the request.
- New `Capture.status` values (`"rescheduled"`, `"no_match"`) added purely for
  audit/analytics clarity, beyond the literal ask.
- `RescheduledView` navigates to `/tasks` rather than `/inbox` (unlike the existing
  `SuccessView`, which goes to Inbox since it's about *drafts* needing confirmation) —
  a rescheduled task is already confirmed, so Inbox isn't the relevant place to see it.
