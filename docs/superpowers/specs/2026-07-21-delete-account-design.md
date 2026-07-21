# Delete Account Feature — Design

## Purpose

Taska has no way for a user to delete their own account today — no backend endpoint, no
frontend action anywhere. Only individual tasks can be deleted (`DELETE /tasks/{id}`).
This plan adds a real, permanent "delete my account" feature: an authenticated backend
endpoint that removes the user and everything owned by them, and a frontend
confirmation flow in Settings that guards against accidental deletion.

## Current state (baseline)

- `backend/app/auth/router.py`: `POST /signup`, `POST /login`, `GET /me`,
  `GET/GET /google/login`/`/google/callback` — no `DELETE` route of any kind.
- `User` model (`backend/app/models.py:9-20`): `email`, `password_hash` (nullable — Google
  sign-in-only users have no password), `google_id`, `google_calendar_refresh_token`,
  `telegram_chat_id`. `tasks = relationship("Task", back_populates="user",
  cascade="all, delete-orphan")` — deleting a `User` row via the ORM already cascades to
  their `Task` rows automatically.
- `Capture.user_id` and `TelegramLinkCode.user_id` (`backend/app/models.py:23-31,60-66`)
  are plain `ForeignKey`s with **no cascade** defined at the model or DB level — deleting
  a `User` row directly would hit a foreign-key violation unless these are cleaned up
  first (and unless the referencing `Task` rows, which point at `Capture` via a nullable
  `capture_id`, are already gone too).
- `DELETE /tasks/{id}` (`backend/app/tasks/router.py:202-220`) is the existing pattern for
  per-task Google cleanup: calls `google_calendar_client.delete_event` /
  `google_tasks_client.delete_task` when the task has a `google_event_id`/
  `google_task_id`, each wrapped in its own try/except that logs and continues — deletion
  of the Taska-side row is never blocked by a Google API failure. This plan's account
  deletion reuses these same two functions, looped over every task, gated by an explicit
  user choice (see below) rather than always running.
- `frontend/lib/auth-context.tsx`'s `logout()` clears the token, resets user state, and
  redirects to `/login` — no server call involved. Account deletion needs an actual API
  call first, then the same client-side cleanup.
- `frontend/app/login/page.tsx` already reads a URL search param for a one-time notice
  (`?error=email_not_verified`) — the established pattern this plan reuses for a
  post-deletion confirmation message, since `SnackbarProvider` is only mounted inside the
  authenticated `(app)` layout and wouldn't survive a redirect to the (unauthenticated)
  login page.
- `frontend/app/(app)/settings/page.tsx` already has a "Вийти з акаунта" (`logout`)
  button as the last item on the screen — this plan adds a second, visually distinct
  destructive action directly below it.

## Scope boundaries

**In scope:** `DELETE /auth/me` endpoint; a typed-confirmation frontend overlay; an
opt-in (unticked by default), Google-Calendar-only checkbox to also clean up
Taska-created Google Calendar events/Tasks; a best-effort final Telegram notice before
unlinking; redirect to a post-deletion login-page notice.

**Out of scope:** revoking the Google OAuth refresh token with Google itself (Google
manages its own token lifecycle; once Taska no longer stores the token, there is nothing
further for Taska to do about it). Any data export step before deletion. Any soft-delete,
grace period, or undo mechanism — this is a real, permanent delete, matching what was
explicitly asked for. Admin-initiated deletion of another user's account (this is
exclusively a self-service, "delete my own account" feature).

## Architecture

### Backend: `DELETE /auth/me`

New route in `backend/app/auth/router.py`:

```
DELETE /auth/me
Body: { "remove_google_events": bool }
Auth: existing get_current_user dependency (same bearer-token check every other
      mutating endpoint already uses — no additional step-up authentication)
Response: 204 No Content on success
```

New `delete_account(user: User, remove_google_events: bool, db: Session) -> None` in a
new `backend/app/auth/service.py` (mirroring the existing `captures/service.py` split
between a thin router and the logic it calls), doing, in this exact order:

1. Fetch all of the user's `Task` rows.
2. If `remove_google_events` is `True`: for each task, call
   `google_calendar_client.delete_event`/`google_tasks_client.delete_task` wherever
   `google_event_id`/`google_task_id` is set — each call wrapped in its own try/except,
   logged and swallowed on failure, exactly matching `DELETE /tasks/{id}`'s existing
   per-task cleanup pattern. Skipped entirely when the flag is `False` (default from the
   frontend) or when the user never connected Google Calendar.
3. If `telegram_chat_id` is set: best-effort `telegram_client.send_message` with a final
   Ukrainian notice, wrapped in try/except (a failed send never blocks deletion).
4. Delete the user's `Task` rows (via the ORM, `db.delete(task)` per task, so this
   composes correctly with the flush ordering below) — then `db.flush()` — then bulk-
   delete `Capture` and `TelegramLinkCode` rows scoped to `user.id` — then `db.delete(user)`
   — then `db.commit()`. This ordering exists specifically because `Capture`/
   `TelegramLinkCode` have no cascade and `Task.capture_id` references `Capture`: tasks
   must be gone before captures are deleted, and everything must be gone before the user
   row itself is deleted.

No new Pydantic response schema is needed (`204 No Content`, matching `DELETE /tasks/{id}`'s
existing contract).

### Frontend: confirmation overlay

New `frontend/components/delete-account-sheet/DeleteAccountSheet.tsx`, opened by a new
"Видалити акаунт" button added to `frontend/app/(app)/settings/page.tsx` directly below
the existing logout button — styled distinctly (an outlined or text-only destructive
style using the `--error` token, not the neutral `.secondary-btn` logout uses, so the two
actions are visually distinguishable at a glance).

The overlay reuses the existing `.flow`/`.flow-header`/`.flow-body` full-screen pattern
already established by `EditTaskSheet`/`CaptureFlow` (this app has no lighter-weight
modal-dialog primitive, and introducing one just for this would be scope creep for a
single use). Contents:

- Warning copy explaining the action is permanent and will delete all tasks.
- An "Також видалити пов'язані події з Google Calendar" checkbox, unticked by default,
  rendered only when `GET /auth/me`'s `google_calendar_connected` is `true` for the
  current user (no point showing it to someone who never connected).
- A text input with placeholder/label asking the user to type an exact confirmation
  word (`ВИДАЛИТИ`) — the delete button stays disabled until the input matches exactly.
- A destructive-styled submit button, disabled during the request, calling
  `api.delete("/auth/me", { remove_google_events: <checkbox state> })` (the existing
  `api.delete` helper in `frontend/lib/api.ts` needs a body-supporting overload added,
  since it currently takes no body parameter — the smallest possible change to that
  shared helper, not a new client).

On success: clear `localStorage`'s token and reset auth state (reusing
`auth-context.tsx`'s existing token-clearing logic — either by exposing a new method or
by having the component call the same two lines `logout()` already does before its own
`router.push`), then `router.push("/login?deleted=1")`.

`frontend/app/login/page.tsx` gains a new one-time notice branch (alongside its existing
`oauthError === "email_not_verified"` branch) rendering a confirmation message when
`searchParams.get("deleted") === "1"`.

## Data flow

**Happy path (with Google cleanup):** user types `ВИДАЛИТИ`, ticks the checkbox, taps
delete → `DELETE /auth/me {remove_google_events: true}` → backend deletes every synced
Google Calendar event/Task → sends a final Telegram notice if linked → deletes captures,
telegram codes, tasks, then the user row → `204` → frontend clears the token → redirects
to `/login?deleted=1`.

**Happy path (without Google cleanup, the default):** identical, except
`remove_google_events: false` is sent and step 2 above is skipped entirely — any
previously-synced Google Calendar events/Tasks are left exactly as they are, orphaned
with no further sync (since the Taska task that owned them no longer exists).

## Error handling

| Failure point | Response |
|---|---|
| Google event/task cleanup call fails (network, revoked token, etc.) | Logged, swallowed — deletion proceeds; matches `DELETE /tasks/{id}`'s existing tolerance for this exact failure mode |
| Telegram notice send fails | Logged, swallowed — deletion proceeds |
| Any other unexpected exception during `delete_account` | Not caught specially — surfaces as the framework's normal 500 response; the whole operation is wrapped in one DB transaction (single `db.commit()` at the end), so a mid-way failure rolls back everything rather than leaving a half-deleted account |
| Frontend: `DELETE /auth/me` request fails | Confirmation overlay shows the existing `ApiError`-message-or-fallback pattern used everywhere else in this app (e.g. `EditTaskSheet`), stays open so the user can retry |
| Confirmation word typed incorrectly | Delete button simply stays disabled — no error state needed, this is a client-side gate, not a server validation |

## Testing / verification approach

Backend: real `pytest` coverage, matching this project's established convention —
`delete_account` tested directly for: full deletion with `remove_google_events=True`
(mocked Google clients asserted called for each synced task); `remove_google_events=False`
(mocked Google clients asserted NOT called); a user with no Google connection and no
Telegram link (simplest case, nothing extra called); a user with a Telegram link (mocked
`send_message` asserted called with the linked chat_id); confirming captures/telegram
link codes/tasks are actually gone from the DB afterward (not just that the `User` row
is gone); confirming a Google-cleanup failure doesn't prevent the account from being
deleted. `DELETE /auth/me` tested at the HTTP level for the 204 response and requiring
auth (401 without a token).

Frontend: no test framework (matches this project's established convention) — `npm run
build`/`npm run lint` clean, plus a browser walkthrough: open the overlay, confirm the
delete button stays disabled until the exact word is typed, confirm the Google checkbox
only appears when Google Calendar is connected, complete a real deletion against a test
account and confirm redirect + login-page notice + that the account can no longer log in.

## Open judgment calls made in this spec (flagged, not blocking)

- Confirmation word chosen as the literal Ukrainian imperative `ВИДАЛИТИ` ("delete") —
  not explicitly specified.
- `api.delete`'s signature gains an optional body parameter — a small, backward-compatible
  change (every existing call site passes no body and is unaffected) rather than a new
  helper function, to avoid two near-identical HTTP helpers in `lib/api.ts`.
- The destructive button's exact visual style (outlined red vs. filled red vs. text-only)
  is left as an implementation detail for the writing-plans stage, to be chosen from
  colors/patterns already established in `globals.css` rather than introducing new CSS
  concepts.
