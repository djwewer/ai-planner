# AI Planner MVP — Design

_Date: 2026-07-18_

## Overview

A mobile-first, AI-assisted to-do planner. The user captures whatever is on
their mind — by voice or text — and the AI turns that free-form brain dump
into structured, prioritized tasks with deadlines and scheduled times, which
the user reviews and confirms either in the web app or via Telegram. The core
loop is **Capture → Inbox (AI triage + review) → Today / Calendar**, backed by
Google Calendar sync and Telegram notifications.

This is the MVP. A second phase (separate UI/UX-focused effort) will follow
once this core loop is working end to end.

## Product Language

The entire product is in **Ukrainian** — every screen, label, button, and
backend-generated error message. This is a single-language product, not an
internationalized one: there is no language switcher and no translation
layer, Ukrainian text is simply what's written everywhere, backend included.
AI triage preserves whatever language the user captured in (typically
Ukrainian) rather than translating task titles. When voice capture is built,
its transcription must be configured for Ukrainian.

## Scope

**In scope for MVP:**
- Capture (text or voice) — a single entry may contain multiple distinct
  tasks/goals
- Inbox — AI-parsed draft tasks (title, priority, deadline, scheduled time),
  reviewed and confirmed by the user before they go live
- Today — auto-populated list: today's scheduled tasks + overdue, sorted by
  priority (Todoist-style)
- Calendar — secondary view of upcoming scheduled tasks, two-way synced with
  Google Calendar
- Auth — email/password and "Sign in with Google" (OAuth/OIDC)
- Telegram bot — notifications (reminders, morning digest, overdue alerts,
  new-tasks-ready alerts) and inline Approve/Reject of draft tasks

**Explicitly deferred (future phases):**
- Weekly plan view
- Task detail page
- Filters (priority / deadline / tags)
- AI-assigned tags
- Slack / Notion notification channels
- Full task editing inside Telegram (bot only supports Approve/Reject; edits
  happen in the web app)
- Enterprise SAML SSO
- UI/UX design pass (second agent's phase)

## Architecture

**Frontend — Vercel**
Next.js (React), mobile-first responsive, built and tested primarily against
iOS Safari and Android Chrome. Screens: Login/Signup, Capture, Inbox, Today,
Calendar. Talks to the backend over HTTPS REST with JWT session tokens.

**Backend — single FastAPI service on the existing Hostinger VPS**, joining
the VPS's existing Docker + Traefik setup (Traefik handles HTTPS termination
and routing via Docker labels — no separate Nginx needed). Internal modules:

- **Auth** — email/password (bcrypt-hashed) + Google OAuth/OIDC, issues JWT
- **Capture** — accepts text directly, or an audio file upload for voice
- **Transcription** — wraps self-hosted open-source Whisper (faster-whisper),
  running on the VPS
- **AI Triage** — sends captured text to the OpenAI API (`gpt-4o-mini`) with a
  structured-output prompt, splitting it into draft task(s): title, priority
  (P1–P4), deadline, and a suggested scheduled time slot (checked against
  Google Calendar free/busy before suggesting a slot). (Amended 2026-07-19:
  originally specified as Claude/Anthropic; switched to OpenAI because the
  project owner has OpenAI billing set up, not Anthropic's. The AI provider
  is isolated behind `app/ai/triage.py`'s `extract_tasks()` interface, so
  this was a contained internal swap, not a redesign.)
- **Tasks** — CRUD + state machine, computes Today and Calendar queries
- **Google Calendar** — stores per-user OAuth refresh tokens, reads events for
  free/busy, writes/updates/deletes events for confirmed tasks
- **Telegram bot** — webhook endpoint for Approve/Reject callbacks and the
  `/start` linking handshake; an in-process scheduler (APScheduler) runs
  periodic jobs for scheduled-time reminders, the morning digest, and overdue
  checks, and fires immediately when a new capture finishes triage

**Data store**: self-hosted PostgreSQL on the same VPS.

**Deliberate MVP simplification**: notifications run on an in-process
scheduler rather than a separate job queue (Celery/Redis) — less infra to
operate, sufficient at single-user scale. Can graduate to a real queue later.

## Core Data Flow

1. **Capture** — user types or records voice. Voice is uploaded to the
   backend and transcribed by Whisper.
2. **Triage** — transcribed/typed text is sent to the Claude API, which
   splits it into draft task(s) with priority, deadline, and a suggested time
   slot. Drafts are saved with `status=draft`.
3. **Notify** — Telegram bot immediately messages the user: "N new tasks
   ready for review," with an Approve/Reject button per task.
4. **Review** — user approves in the web Inbox, or taps ✅ in Telegram. On
   approval: `status=confirmed`; if a time slot was set, the backend creates
   a Google Calendar event (`google_event_id` stored). Reject discards the
   draft.
5. **Today** — auto-computed: confirmed tasks scheduled for today, plus
   anything overdue, sorted by priority.
6. **Calendar** — confirmed tasks with a scheduled time, shown alongside the
   synced Google Calendar events.
7. **Reminders** — scheduler sends a Telegram message at each task's
   scheduled time, a morning digest of the Today list, and overdue nudges for
   anything unfinished past its time/deadline.

## Telegram Authorization Flow

Telegram bots can't perform a browser redirect back the way OAuth does, so
this is approximated:

1. User taps "Authorize with Telegram" in the app.
2. App generates a one-time code, opens a deep link:
   `t.me/YourBot?start=<code>`.
3. User's Telegram app opens the bot chat; they tap **Start**.
4. Bot receives `/start <code>`. Telegram already provides the chat_id and
   name for free — no extra info is asked of the user.
5. Backend matches the code to the logged-in user's account and stores
   `telegram_chat_id`.
6. Bot replies "✅ Connected!" with a button linking back into the app.
7. Meanwhile, the app has been polling for the link to complete and flips its
   own UI to "Connected" automatically — returning to the app isn't required
   to see it worked.

One-time codes live in a `telegram_link_codes` table and expire after a short
window.

## Data Model (PostgreSQL)

**users**
- `id`, `email` (unique), `password_hash` (nullable if Google-only),
  `google_id` (nullable), `google_calendar_refresh_token` (encrypted,
  nullable), `telegram_chat_id` (nullable), `created_at`

**captures**
- `id`, `user_id`, `input_type` (text/voice), `raw_text`,
  `status` (`processing` / `complete` / `incomplete` / `failed`),
  `created_at`

**tasks**
- `id`, `user_id`, `capture_id`, `title`, `priority` (1–4),
  `deadline` (date, nullable), `scheduled_at` (datetime, nullable),
  `status` (`draft` / `confirmed` / `done` / `rejected`),
  `google_event_id` (nullable), `created_at`, `updated_at`

**telegram_link_codes**
- `code`, `user_id`, `expires_at`, `used`

## Error Handling

- **Transcription total failure** (unintelligible audio / API error) →
  capture marked `failed`; user is prompted to redictate/retype from scratch.
- **Transcription partial/uncertain** (audio transcribed fine, but AI triage
  is unsure about a deadline, task boundary, or other detail) → capture/task
  marked `incomplete`; the Inbox highlights the specific uncertain field(s)
  and prompts the user to confirm or fill them in during review, rather than
  silently guessing or leaving it blank.
- **Claude triage API failure/timeout** → capture shows "processing failed"
  in the Inbox with a retry action.
- **AI can't determine a deadline/time** → field left null; task is still
  created as a draft, user fills it in during review.
- **Google Calendar push fails after confirm** → task stays `confirmed` in
  the DB regardless; sync is retried on the next scheduler tick; app shows a
  "calendar sync pending" indicator.
- **Google OAuth token expired/revoked** → triage still proceeds without
  conflict-checking; app shows a reconnect banner.
- **Duplicate Telegram button taps** → idempotent no-op; bot edits the
  message to reflect current state.
- **Missed reminders during VPS downtime** → accepted risk for MVP
  (single-user, no catch-up queue needed).

## Testing

- Unit tests for the AI triage parser (mocked Claude responses → correct
  task fields, including the `incomplete`-field-flagging logic) and task
  state transitions.
- Integration test for the full happy path: capture → draft → confirm →
  calendar event, with Claude and Google Calendar mocked.
- Manual QA specifically on real iPhone Safari and Android Chrome for voice
  capture (the highest-risk surface for this app), plus an end-to-end
  Telegram link + approve/reject pass, and a real Google Calendar sync check.
