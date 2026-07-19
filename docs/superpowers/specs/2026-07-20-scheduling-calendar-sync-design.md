# AI Planner — Plan 4: Scheduling & Google Calendar Sync — Design

_Date: 2026-07-20_

## Overview

Adds real scheduling to the app: AI extracts an explicit time-of-day from a
capture when one is stated ("at 3pm"), an optional "Schedule" action lets
the user ask the AI for a free time slot on any unscheduled task, and
confirmed scheduled tasks sync to the user's real Google Calendar as
events (created/updated/deleted as the task changes). A new Calendar view
page (day/week/month) displays scheduled tasks alongside the user's real
Google Calendar events. A new Settings page houses the Calendar connection,
built to also hold a future Telegram connection (Plan 6).

This is a genuinely larger plan than Plans 1–3 — the user explicitly chose
to keep scheduling, sync, and the calendar UI together as one plan rather
than splitting it, after being offered the option to split.

## Scope

**In scope:**
- Settings page (`/settings`) — Google Calendar connect/disconnect status.
  Structured so a "Connect Telegram" button can be added later (Plan 6)
  without rework.
- Separate Calendar OAuth connection flow (distinct from login), requesting
  Calendar scope specifically — works regardless of how the user logged in.
- AI triage extracts an explicit stated time (`scheduled_at`) directly from
  the capture text, same trust level as existing date extraction. No time
  stated → unchanged: a plain date-only `deadline`, no automatic slotting.
- Optional "Schedule" action (per-task, in Inbox/Tasks/Today) for tasks
  without a time — AI checks the user's real Google Calendar and returns a
  few free slots to choose from.
- Google Calendar sync: confirming a scheduled task creates a Calendar
  event; editing its time or deleting/unscheduling it updates or removes
  that event.
- Calendar view page (`/calendar`) — day / week / month switcher. Shows
  scheduled tasks (editable) and real Google Calendar events (read-only,
  for context) together; date-only tasks and all-day Google events appear
  in an all-day row.
- Today page gains time display for scheduled tasks (sorted by time within
  the day).

**Explicitly out of scope:**
- Telegram bot (Plan 6).
- Background retry queue for failed calendar syncs — failures surface
  inline and are retried by re-triggering the action manually; no
  scheduler infrastructure in this plan.
- Encrypting the stored Calendar refresh token at rest (plain-text column
  for this MVP, noted as a future hardening item).

## Architecture

**New backend module `app/google_calendar.py`** — wraps the Google
Calendar REST API using the user's stored refresh token (refreshing the
access token as needed):
- `get_free_busy(user, date) -> list[(start, end)]`
- `create_event(user, task) -> str` (returns the new `google_event_id`)
- `update_event(user, task) -> None`
- `delete_event(user, google_event_id) -> None`

**New OAuth flow**, separate from login:
- `GET /auth/google/calendar/connect` — redirects to Google's consent
  screen requesting the `https://www.googleapis.com/auth/calendar` scope
  (one broad scope covers both free/busy checks and event read/write,
  simpler than juggling multiple narrower scopes for an MVP).
- `GET /auth/google/calendar/callback` — exchanges the code, stores the
  refresh token on the user, redirects back to `/settings`.

**New/changed endpoints:**
- `GET /auth/me` gains `google_calendar_connected: bool`.
- `GET /tasks/{id}/schedule-suggestions` — returns a few free slots for
  the task's deadline day (or a sensible default window if no deadline),
  checked against the user's real calendar.
- `PATCH /tasks/{id}` gains `scheduled_at` support. Confirming a task with
  `scheduled_at` set (draft → confirmed) creates the Calendar event;
  editing `scheduled_at` on an already-synced task updates it; clearing it
  or deleting the task deletes the event.
- `GET /tasks/calendar?start=&end=` — tasks (scheduled or date-only)
  within a date range, powering all three calendar view modes.
- `GET /calendar/events?start=&end=` — proxies real Google Calendar events
  in that range for read-only display.

**Frontend:**
- `/settings` — Calendar connect/disconnect status and action.
- `/calendar` — day/week/month switcher; merges the app's tasks with real
  Google events in the display.
- Today page — shows `HH:MM — title` for scheduled tasks, sorted by time
  within the day; unscheduled tasks unaffected.
- "Schedule" button added to task cards (Inbox/Tasks/Today) wherever a
  task has no `scheduled_at` yet.

## Data Model Changes (PostgreSQL)

**`users` table gains:**
- `google_calendar_refresh_token` (string, nullable) — null means not
  connected; set once the Calendar OAuth flow completes. `/auth/me`
  exposes this as a clean boolean rather than leaking the token.

**`tasks` table gains:**
- `scheduled_at` (datetime, nullable) — independent of `deadline`; a task
  can have a deadline date without a specific time, or both.
- `google_event_id` (string, nullable) — set once successfully synced to
  Google Calendar; null means not scheduled or not yet synced.

## Core Flows

1. **Connect Calendar** — `/settings` → "Підключити Google Calendar" →
   Google consent screen (Calendar scope) → back to `/settings`, connected.
2. **Explicit time in a capture** — "Подзвонити клієнту о 15:00 завтра" →
   triage sets `scheduled_at` directly from the stated time (pure text
   parsing, same trust level as date extraction). Lands in the Inbox as an
   editable draft with that time.
3. **Scheduling an existing task** — tap "Запланувати" on an unscheduled
   task → backend checks the user's Calendar for the task's deadline day →
   returns free slots → user picks one → `scheduled_at` is set.
4. **Confirming/editing a scheduled task** — approving a draft, or editing
   an already-confirmed task's time, with `scheduled_at` set → backend
   creates or updates the Google Calendar event, storing `google_event_id`.
   If Calendar isn't connected or the push fails, the task itself still
   saves — the user sees a "не синхронізовано з календарем" indicator and
   can retry by editing the task again.
5. **Deleting/unscheduling** — deleting a task, or clearing its
   `scheduled_at`, deletes the corresponding Google Calendar event via the
   stored `google_event_id`.
6. **Calendar view** — `/calendar` defaults to day view (today,
   00:00–24:00). Switching view re-fetches tasks + real events for the new
   range. Scheduled tasks show at their time slot; date-only tasks and
   all-day Google events show in an all-day row; real Google events are
   visually distinguished and not clickable/editable.

## Error Handling

- **Calendar not connected** when trying to use "Schedule" → the action is
  unavailable, with a prompt linking to `/settings`.
- **Google OAuth token expired/revoked** → detected on next API call,
  `google_calendar_connected` flips to false, `/settings` prompts
  reconnect. Existing synced events aren't touched automatically.
- **Calendar push fails on confirm/edit** → task still saves in the DB;
  `google_event_id` stays null/unchanged; frontend shows a sync-pending
  indicator; retried by re-editing the task (no automatic background
  retry in this plan).
- **Calendar delete fails** → logged; the task deletion in the DB proceeds
  regardless — never block a user action on an external API failure,
  matching this app's existing graceful-degradation philosophy.

## Testing

Per the project owner's request to minimize development overhead, this
plan keeps automated test-writing to a minimum during implementation and
concentrates what testing there is toward the end rather than spreading a
full TDD cycle across every task:
- A small number of backend tests for `google_calendar.py` (external API
  client mocked) covering the real happy path only: free/busy parsing,
  event create/update/delete.
- One or two integration tests confirming that a Calendar push failure
  doesn't block the underlying task save/delete (the graceful-degradation
  behavior is the one thing worth locking in with a test, since it's easy
  to regress accidentally).
- No automated test can verify real Google Calendar behavior — manual QA:
  connect a real Google account, confirm a scheduled task actually appears
  in Google Calendar, edit/delete it and confirm the real event
  updates/disappears, and check all three calendar views render correctly
  on a real phone.
