# AI Planner — Plan 2: AI Capture & Inbox — Design

_Date: 2026-07-19_

> **Amendment (2026-07-19, post-implementation):** the AI provider was
> switched from Claude (Anthropic) to OpenAI's `gpt-4o-mini`, because the
> project owner has OpenAI billing set up and not Anthropic's. Every mention
> of "Claude"/"Anthropic" below reflects the original design decision;
> `app/ai/triage.py`'s `extract_tasks()`/`ExtractedTask` interface is
> unchanged, so this was a contained internal swap of that one module, not a
> redesign of the capture/inbox flow.

## Overview

Builds the AI-assisted core loop on top of Plan 1's Foundation (auth + manual
task CRUD, live in production): the user types a free-form capture, Claude
splits it into draft tasks, the user reviews/edits/approves them in an
Inbox, and confirmed tasks with a deadline of today or earlier surface on a
new Today view. This plan is text-only — voice capture is Plan 3, scheduled
time-of-day and Google Calendar sync are Plan 4, Telegram is Plan 5.

This plan also retrofits Plan 1's existing pages (login, signup, tasks) to
the product's language, per the master spec's Product Language section:
**the whole app is Ukrainian**, backend error messages included.

## Scope

**In scope for this plan:**
- Retranslate Plan 1's login/signup/tasks page text to Ukrainian
- `/capture` — text box, submits to Claude synchronously, shows the result
- AI Triage — Claude Haiku 4.5 splits capture text into draft task(s):
  title, priority (P1–P4), deadline. No time-of-day scheduling yet.
- `/inbox` — draft tasks with full inline editing (title/priority/deadline)
  before Approve; Reject discards
- `/today` — confirmed tasks with deadline ≤ today, sorted by priority;
  `/tasks` (full backlog, from Plan 1) stays as-is alongside it
- A shared nav bar across authenticated pages (Ukrainian labels)

**Explicitly deferred:**
- Voice capture (Plan 3) — noted now that Whisper will need Ukrainian
  language configuration when that plan is built
- Scheduled time-of-day and Google Calendar sync (Plan 4)
- Telegram notifications/approval (Plan 5)

## Architecture

**Backend additions** (alongside Plan 1's `auth`/`tasks` modules):

- **`app/ai/triage.py`** — wraps the Claude API (model: Haiku 4.5) via the
  `anthropic` SDK, using Claude's tool-use (function calling) for reliable
  structured output. Given capture text and today's date, returns a list of
  `{title, priority, deadline}` items. Today's date is included in the
  prompt so Claude can resolve relative dates ("до п'ятниці", "наступного
  тижня") to absolute ones. The prompt instructs Claude to keep task titles
  in the same language as the input rather than translating.
- **`app/captures/router.py`** — `POST /captures`: creates a `Capture` row,
  calls the triage module synchronously, creates one `Task` row per
  extracted item with `status="draft"` and `capture_id` set, and returns
  them (an empty list if Claude found nothing actionable).
- **`app/tasks/router.py` extensions** — `GET /tasks?status=draft` (Inbox
  listing) and `GET /tasks/today` (confirmed tasks with `deadline <= today`,
  sorted by priority ascending then deadline ascending). The existing
  `PATCH /tasks/{id}` already supports editing title/priority/deadline/status,
  so Approve is a PATCH with any edits plus `status="confirmed"`, and Reject
  is a PATCH with `status="rejected"` (kept for history, filtered out of
  every view).

**New config:** `ANTHROPIC_API_KEY` added to backend settings and `.env`.

**Frontend additions:**
- `/capture` — text box + submit, shows "Знайдено N задач" or "Задач не
  знайдено" (see Core Flow)
- `/inbox` — draft task cards with editable title/priority/deadline fields
  and Approve/Reject buttons
- `/today` — same complete-checkbox list style as `/tasks`, filtered/sorted
  server-side
- A small shared nav component (Сьогодні / Задачі / Занотувати / Вхідні /
  Вийти) added to every authenticated page, including the Plan 1 pages
- Plan 1's login/signup/tasks page copy retranslated to Ukrainian; backend
  error strings (e.g. invalid credentials, task not found) rewritten in
  Ukrainian directly, since this is a single-language product with no
  translation layer

## Core Data Flow

1. User types a capture on `/capture`, submits.
2. `POST /captures` creates the `Capture` row, sends the text + today's date
   to Claude, gets back zero or more `{title, priority, deadline}` items.
3. Zero items → `Capture.status="complete"`, no tasks created, frontend
   shows "Задач не знайдено" ("No tasks found").
4. One or more items → a `Task` row per item, `status="draft"`,
   `capture_id` set; frontend shows "Знайдено N задач — перевірте їх у
   Вхідних" with a link to `/inbox`.
5. On `/inbox`, each draft shows editable title/priority/deadline.
   **Approve** → `PATCH /tasks/{id}` with edits + `status="confirmed"`.
   **Reject** → `PATCH` `status="rejected"`.
6. `/today` and `/tasks` only ever show `confirmed`/`done` tasks — drafts
   and rejected tasks never appear in either.

## Data Model Changes (PostgreSQL)

**New table `captures`**
- `id`, `user_id`, `raw_text`, `status` (`processing` / `complete` /
  `failed`), `created_at`

**`tasks` table gains one column**
- `capture_id` (nullable FK to `captures`) — null for Plan 1's
  manually-created tasks, set for AI-drafted ones

No migration is needed for `status` values — it's already a plain string
column (Plan 1 established `confirmed`/`done`; this plan's `draft`/
`rejected` are just new values the backend and frontend logic use).

## Error Handling

- **Claude API failure/timeout** → `Capture.status="failed"`;
  `POST /captures` returns an error; frontend shows "Не вдалося обробити,
  спробуйте ще раз" ("Couldn't process that, try again"). No partial or
  zombie draft tasks are created.
- **Claude returns an uncertain deadline** → left `null` on that draft
  task; the Inbox shows it as unset and the user fills it in (or leaves it)
  before approving — reuses Plan 1's existing null-deadline handling.
- **Malformed/schema-violating Claude response** → treated the same as an
  API failure (`status="failed"`), never silently ignored or guessed at.

## Testing

- Unit tests for the triage module with the Anthropic client mocked:
  verify the prompt includes today's date, and that a mocked tool-use
  response correctly maps to `Task` rows with the right fields.
- Integration tests for `POST /captures` (zero-task case, multi-task case,
  Claude-failure case) and the Inbox/Today filtering logic (`GET
  /tasks?status=draft`, `GET /tasks/today` correctly exclude drafts/rejected
  and sort by priority).
- Manual QA on the deployed app: submit a capture with 2–3 naturally-phrased
  Ukrainian tasks, confirm they land in the Inbox correctly, edit one,
  approve/reject others, and confirm the Today view reflects them correctly
  (backdating a deadline to test the overdue case).
