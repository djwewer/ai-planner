# AI Planner — Plan 6: Telegram Bot — Design

_Date: 2026-07-20_

## Overview

Adds a Telegram bot that keeps the user on top of their tasks without opening
the app: it notifies them when new AI-triaged tasks are ready for review, at
each task's scheduled time, with a daily morning digest, and with repeating
overdue nudges — and lets them Approve or Reject a draft task with an inline
button tap, without leaving Telegram. This is the last item from the original
MVP roadmap; Plans 1–4 (auth, capture/triage, Inbox, Today, Calendar sync) are
already live in production.

This closely follows the Telegram design already sketched in the original
master spec (`docs/superpowers/specs/2026-07-18-ai-planner-mvp-design.md`),
adjusted to the app's current actual shape after Plans 1–4 (e.g. the real
`_sync_task_calendar` helper this plan reuses didn't exist yet when the master
spec was written).

## Scope

**In scope:**
- A "Підключити Telegram бота" button in Settings, using a one-time-code deep
  link to link the user's Telegram chat to their account (Telegram bots can't
  do a browser OAuth redirect, so this is the standard workaround).
- Four notification types: new-tasks-ready (immediate, after AI triage),
  scheduled-time reminders, a daily morning digest (09:00 Kyiv time), and
  daily-repeating overdue nudges.
- Inline Approve/Reject buttons on new-tasks-ready notifications, editing the
  message in place once tapped (idempotent on duplicate taps).

**Explicitly out of scope (matches the original spec):**
- Creating tasks by texting the bot — capture stays in the web app only.
- Full task editing inside Telegram — only Approve/Reject; edits happen in
  the web app.
- Slack/Notion notification channels.
- Automatic unlinking if the user blocks the bot (failures are logged, not
  auto-recovered, in this MVP).

## Architecture

**Webhook, not long-polling.** Telegram POSTs updates to a new
`POST /telegram/webhook` route. The VPS already terminates HTTPS via Traefik
and every other external integration in this app (Google login OAuth,
Calendar OAuth) is a plain request/response FastAPI route with no extra
long-running process — webhook fits that same pattern with no new
infrastructure. Telegram's `secret_token` mechanism (a header Telegram
attaches to every webhook POST, configured via `setWebhook`) verifies
requests genuinely came from Telegram.

**New backend module `app/telegram/client.py`** — a thin wrapper around
Telegram's Bot API using plain `httpx` calls, matching the existing style of
`app/google_calendar/client.py` rather than pulling in a heavier library like
`python-telegram-bot`:
- `send_message(chat_id, text, reply_markup=None) -> dict`
- `edit_message(chat_id, message_id, text, reply_markup=None) -> None`
- `answer_callback_query(callback_query_id, text=None) -> None`

**New module `app/telegram/router.py`** — the webhook endpoint, handling two
update shapes: `message` (only `/start <code>` is meaningful) and
`callback_query` (`approve:<task_id>` / `reject:<task_id>`).

**New module `app/telegram/scheduler.py`** — APScheduler running in-process
inside the FastAPI app (matching the master spec's "deliberate MVP
simplification" of avoiding a separate job queue), registering:
- A once-a-minute job for scheduled-time reminders.
- A once-daily job at 09:00 Kyiv time for the morning digest + overdue
  nudges (combined into one job since both run on the same daily cadence).

The new-tasks-ready notification is not scheduled — it's fired directly from
`app/captures/router.py` right after AI triage completes, if the user has a
`telegram_chat_id`.

**Frontend — Settings page** gains a "Підключити Telegram бота" section next
to the existing Google Calendar one, following the same
connect-button-plus-poll pattern.

## Telegram Authorization Flow

1. User taps "Підключити Telegram бота" in Settings (authenticated `fetch()`,
   same JWT-header pattern as the Calendar connect button).
2. `GET /telegram/connect` generates a one-time code, stores it in
   `telegram_link_codes` (10-minute expiry), returns
   `{"deep_link": "https://t.me/<bot_username>?start=<code>"}`.
3. Frontend does `window.location.href = deep_link`, opening the user's
   Telegram app to the bot's chat.
4. User taps **Start**. Telegram sends `/start <code>` to the webhook, which
   already includes the chat's `chat_id` and the user's Telegram name for
   free — nothing else is asked of the user.
5. Backend validates the code (exists, not expired, not used), sets
   `users.telegram_chat_id`, marks the code used, and replies via the bot
   "✅ Підключено!".
6. Meanwhile, the Settings page polls `GET /auth/me` every few seconds while
   waiting and flips to "✅ Підключено" automatically once
   `telegram_connected` is true — no manual refresh needed.
7. If the code is invalid/expired/already used, the bot replies "Код
   недійсний або застарів, спробуйте ще раз у Налаштуваннях." and nothing is
   linked.

## Data Model Changes (PostgreSQL)

**`users` table gains:**
- `telegram_chat_id` (BigInteger, nullable, unique) — null means not linked.
  `/auth/me` exposes this as `telegram_connected: bool`, same pattern as
  `google_calendar_connected`.

**New `telegram_link_codes` table:**
- `code` (String, primary key)
- `user_id` (Integer, FK → `users.id`)
- `expires_at` (DateTime)
- `used` (Boolean, default `False`)

**`tasks` table gains:**
- `reminder_sent_at` (DateTime, nullable) — set once the scheduled-time
  reminder for this task has been sent, so the once-a-minute scheduler tick
  never double-sends it.
- `last_overdue_nudge_at` (DateTime, nullable) — set to the date of the last
  overdue nudge sent for this task, so the daily job sends at most one nudge
  per calendar day. Both fields are purely internal bookkeeping, never shown
  in the UI.

## Notifications & Scheduler

- **New-tasks-ready** — fires immediately (not scheduled) from
  `POST /captures`, right after AI triage produces draft tasks, if
  `telegram_chat_id` is set. Message: `"🆕 N нових задач готові до
  перегляду"`. Up to 5 tasks are listed inline, each with its own
  Approve/Reject button pair; if there are more than 5, the message instead
  links back to the web Inbox for the rest ("...і ще N — переглянути в
  Inbox").
- **Scheduled-time reminder** — an APScheduler job ticking every minute,
  selecting tasks with `status = "confirmed"` (not `done`, which doesn't need
  reminding) where `scheduled_at` falls between 15 minutes ago and now, and
  `reminder_sent_at IS NULL`. Message: `"⏰ 14:00 — Зробити сальто"`. Sets
  `reminder_sent_at = now()` right after a successful send. The 15-minute
  lower bound means a reminder that's already more than 15 minutes late
  (e.g. after the scheduler was down) is marked as sent without notifying,
  rather than firing a late/stale reminder once the process resumes — this
  matches the master spec's explicit "missed reminders during VPS downtime →
  accepted risk, no catch-up queue" stance.
- **Morning digest** — one APScheduler job firing daily at 09:00 Kyiv time,
  for every user with a `telegram_chat_id`, sending their Today list (same
  query as `GET /tasks/today`). Message: `"☀️ На сьогодні:\n- 09:30 Купити
  молоко (P2)\n- Зробити звіт (P1, термін сьогодні)"`. If the Today list is
  empty, no message is sent (no reason to notify about nothing).
- **Overdue nudge** — runs in the same daily 09:00 job. Selects `confirmed`
  tasks where `deadline < today` or `scheduled_at < now`, and the date part of
  `last_overdue_nudge_at` is not already today. Message: `"⚠️
  Просрочено:\n- Зробити звіт (термін був 18.07)"`. Sets
  `last_overdue_nudge_at = now()` — repeats every day the task stays
  unfinished, stops once it's `done` or `rejected`.

## Approve/Reject Flow

Each draft-task line in a new-tasks-ready notification carries inline
buttons with `callback_data` of `approve:<task_id>` / `reject:<task_id>`.
On a `callback_query` update:

1. Look up the task by ID; verify `task.user.telegram_chat_id` matches the
   incoming chat's ID — never trust the task ID alone, since `callback_data`
   round-trips through Telegram's servers and a stale/forwarded button tap
   must not act on someone else's task.
2. If the task is not `draft` anymore (already resolved by a prior tap or via
   the web Inbox), skip straight to step 4 with the task's current state —
   this makes a duplicate tap idempotent.
3. On `approve`: set `status = "confirmed"`, then call
   `app.tasks.router._sync_task_calendar` — the exact same helper the web
   Inbox's approve action already uses — so a Telegram approval creates the
   Google Calendar event exactly like a web approval does, with no duplicated
   sync logic. On `reject`: set `status = "rejected"`.
4. Edit the original Telegram message (`editMessageText` with a new
   `reply_markup` that has no buttons) to show the resolved state, e.g.
   strikethrough title + "✅ Підтверджено" or "❌ Відхилено".
5. Call `answerCallbackQuery` so Telegram's client stops showing a loading
   spinner on the tapped button.

## Error Handling

- **Telegram API call fails** (send/edit message, answer callback) — caught
  and logged via `logger.exception`, never raised into the caller. A failed
  notification must never block task creation, AI triage, or calendar sync,
  matching this app's existing graceful-degradation philosophy (established
  in Plan 4's calendar sync).
- **Webhook receives a callback for an unknown task, or one that doesn't
  belong to the calling chat** — answers the callback query with a generic
  message, no-ops, logs a warning.
- **Link code invalid, expired, or already used** — bot replies with the
  Ukrainian message above; nothing is linked; the code is left `used=false`
  only if it never matched at all (an expired-but-valid code is left as-is,
  simply rejected).
- **User blocks the bot** (Telegram returns 403 on send) — caught and
  logged per-send; no automatic unlinking in this MVP, matching the master
  spec's "accepted risk" tone for similarly low-stakes single-user failure
  modes. A future improvement, not blocking this plan.
- **Webhook receives an update shape we don't handle** (e.g. an edited
  message, a different command) — ignored, returns 200 OK (Telegram expects
  a 200 regardless, or it retries the webhook delivery).

## Testing

Per the project owner's standing preference for this project (confirmed
across Plans 3 and 4), automated test-writing stays minimal and concentrated
near the end of implementation rather than a full TDD cycle per task:
- A small set of tests for `app/telegram/client.py` (external HTTP calls
  mocked) covering the real happy path: send message, edit message, answer
  callback query.
- One test proving the linking flow rejects an expired or already-used code.
- One test proving an `approve` callback triggers the same
  `_sync_task_calendar` path as the existing web-Inbox approval (reusing the
  helper directly, not duplicating the assertion of Calendar-sync behavior
  already covered by Plan 4's tests).
- No automated test can verify real Telegram behavior — manual QA: link a
  real Telegram account via the deep link, trigger a real capture and
  confirm the new-tasks-ready message and Approve/Reject buttons work end to
  end, verify a scheduled-time reminder fires at the right time, and check
  the morning digest/overdue nudge content once (temporarily adjusting a
  task's scheduled time to trigger it on demand rather than waiting for
  09:00).
