# Plan 7: Real Taska UI/UX Implementation — Design

## Purpose

Implement the approved Taska visual/interaction design in the real Next.js frontend
(`frontend/`), replacing the current unstyled functional shell. The design itself is
**not** being decided here — it was already designed and approved through two rounds
of feedback as an interactive HTML/CSS/JS artifact (built against
`docs/Taska_UI_UX_Design_Brief_with_References/Taska_UI_UX_Design_Brief.md`), published
at `https://claude.ai/code/artifact/01fc579a-6e7a-48f5-8f72-a4e6fef55f94` and preserved
at `/private/tmp/claude-501/-Users-andriitypusiak-Documents-Cowork-Playground-ai-planner/d5e079f1-3757-4be6-8c78-3048694a7937/scratchpad/taska-preview.html`.
This spec covers only the technical architecture for porting that approved design into
production code and wiring it to the real backend.

## Current state (baseline)

`frontend/app/` has one route per screen, each a self-contained client component with
zero shared styling (`globals.css` is a 49-line stub) and no component library:

- `today/page.tsx` — `GET /tasks/today`, flat checkbox list
- `calendar/page.tsx` — day/week/month view toggle, `GET /tasks/calendar` +
  `GET /calendar/events`, already contains the date-range logic the new Tasks screen
  needs
- `tasks/page.tsx` — flat all-tasks list with inline create form (`GET /tasks`)
- `inbox/page.tsx` — draft review, inline-editable fields, `PATCH /tasks/{id}`
- `capture/page.tsx` — voice (MediaRecorder → `POST /transcribe`) and text
  (`POST /captures`) capture, in one page
- `settings/page.tsx` — Google Calendar + Telegram connection state, `GET /auth/me`
- `components/nav.tsx` — text link nav; `components/schedule-button.tsx` — fetches
  `GET /tasks/{id}/schedule-suggestions`, patches a chosen slot

Backend API surface (all already live, no backend changes required by this plan):

| Endpoint | Notes |
|---|---|
| `GET /tasks?status=` | filter by status; default filter is `confirmed,done` |
| `GET /tasks/today` | `deadline <= today`, status confirmed/done, overdue rolls in |
| `GET /tasks/calendar?start=&end=` | date range, status confirmed/done |
| `GET /tasks/{id}/schedule-suggestions` | free/busy slot suggestions |
| `PATCH /tasks/{id}` | partial update incl. `status`, `scheduled_at`, `deadline`, `title`, `priority` |
| `DELETE /tasks/{id}` | |
| `POST /captures` | `{raw_text}` → AI triage → drafts (`status=draft`) |
| `POST /transcribe` | multipart audio → `{text}` |
| `GET /auth/me` | includes `google_calendar_connected`, `telegram_connected` |
| `GET /auth/google/calendar/connect` / `/callback` | OAuth |
| `GET /calendar/events?start=&end=` | live Google Calendar events |
| `GET /telegram/connect` | returns a deep link |

`Task.status` values in use: `draft`, `confirmed`, `done`, `rejected`. There is no
`completed_at` column — only `updated_at`.

## Scope boundaries

**In scope:** `/tasks` (merged Day/Week/Month), `/inbox`, `/archive` (new), `/settings`,
the "+" create flow (voice/text/processing/success), the task edit sheet, bottom nav,
design tokens, Inter font, Lucide icons.

**Out of scope:** `/login`, `/signup`, `/auth/callback` (never covered by the brief or
the artifact — left as-is). Desktop-specific layout beyond a centered max-width
container. PWA manifest/service worker/offline support (the brief explicitly says not
to promise offline capability). Any backend/API changes — everything below is built
against the existing surface.

## Architecture

### Route structure

```
app/
  (app)/                      route group — authenticated shell
    layout.tsx                 BottomNav + CaptureFlowProvider + EditTaskProvider
    tasks/page.tsx              Day/Week/Month, replaces today/ + calendar/
    inbox/page.tsx
    archive/page.tsx            new
    settings/page.tsx
  login/, signup/, auth/callback/   unchanged, outside the (app) group
  layout.tsx                   root layout: html/body, Inter font, AuthProvider
  globals.css                  design tokens ported from the artifact
```

`today/`, `calendar/`, `capture/`, and `tasks/`'s current flat-list implementation are
deleted; their logic is absorbed as described below. `components/nav.tsx` is replaced
by `components/bottom-nav/`.

**Why a route group + overlay providers, not one page with client-side view state:**
the artifact's "+" button and task-edit sheet slide over whatever screen is currently
showing, without navigating away or losing the underlying screen's state. Keeping
`/tasks`, `/inbox`, `/archive`, `/settings` as real routes preserves normal Next.js
navigation (shareable URLs, back button, code splitting) while the create-flow and
edit-sheet are pure UI overlays — React state in providers mounted at the `(app)`
layout, not routes. `BottomNav` reads the active tab from `usePathname()`.

### Component layout

```
components/
  bottom-nav/BottomNav.tsx + .module.css
  create-sheet/CreateSheet.tsx          "+" bottom sheet: Voice / Text choice
  capture-flow/
    VoiceFlow.tsx                        mic capture, reuses MediaRecorder logic
    TextFlow.tsx                         textarea + submit
    ProcessingView.tsx                   shared spinner/step state
    SuccessView.tsx                      shared success state
  edit-task-sheet/EditTaskSheet.tsx      Title / Date / Time fields
  task-row/TaskRow.tsx                   checkbox + title, shared by Day/Week/Archive
  date-strip/DateStrip.tsx               Tasks/Day horizontal date picker
  week-list/WeekList.tsx
  month-grid/MonthGrid.tsx               + MonthDayTasks.tsx (scrollable list below grid)
  integration-card/IntegrationCard.tsx   Settings: Google Calendar + Telegram, shared shape
lib/
  api.ts                       unchanged
  auth-context.tsx             unchanged
  capture-flow-context.tsx     new: which overlay stage is open, shared state
  edit-task-context.tsx        new: currently-edited task, open/close
```

`ScheduleButton` behavior (fetch free/busy slots, patch a chosen `scheduled_at`) moves
inside `EditTaskSheet` as the artifact's edit sheet is the only place a time gets
assigned — the standalone component is retired, its logic is not.

### Styling

- `app/globals.css` gets the artifact's full `:root` custom-property token set (colors,
  spacing scale, radius scale, shadows) ported verbatim, plus a minimal reset.
- One CSS Module per component (e.g. `BottomNav.module.css`), styled from the tokens —
  no Tailwind, per the earlier decision to minimize drift from the approved artifact.
- Layout is mobile-first per the brief (primary viewport 390px, tested 320–430px); on
  wider viewports the app content is capped at a max-width and centered rather than
  reflowed into a desktop layout.

### Fonts & icons

- Inter loaded via `next/font/google` in the root layout, exposed as the `--font-ui`
  custom property (replaces the artifact's system-font placeholder).
- `lucide-react` added as a dependency. Each artifact `ICON_*` placeholder maps to a
  real Lucide component, imported directly per file (no wrapper abstraction):

| Artifact icon | Lucide component |
|---|---|
| ICON_CAL_CHECK / ICON_CAL_CHECK_LG | `CalendarCheck2` |
| ICON_CALENDAR_DAYS | `CalendarDays` |
| ICON_INBOX / ICON_INBOX_LG | `Inbox` |
| ICON_ARCHIVE | `Archive` |
| ICON_SETTINGS | `Settings` |
| ICON_PLUS | `Plus` |
| ICON_MIC | `Mic` |
| ICON_MIC_OFF | `MicOff` |
| ICON_TYPE | `Type` |
| ICON_STOP | `Square` (filled) |
| ICON_ARROW_LEFT | `ArrowLeft` |
| ICON_CHECK_SM | `Check` |
| ICON_CHEVRON_LEFT / ICON_CHEVRON_RIGHT | `ChevronLeft` / `ChevronRight` |
| ICON_ALERT | `AlertTriangle` |
| ICON_WIFI_OFF | `WifiOff` |
| ICON_TELEGRAM | `Send` (Lucide has no Telegram brand glyph) |

## Data wiring per screen

**Tasks — Day tab:** date strip picks a date. If it's today, call `GET /tasks/today`
(preserves the existing overdue-rollup behavior); otherwise `GET
/tasks/calendar?start=<date>&end=<date>`. Merge in `GET /calendar/events` for that day,
de-duplicating any event whose `id` matches a task's `google_event_id` (existing logic
from `calendar/page.tsx`). Checkbox toggles `PATCH /tasks/{id} {status}`.

**Tasks — Week tab:** `GET /tasks/calendar` over the visible week + `GET
/calendar/events`, same merge/de-dupe rule, rendered as the artifact's per-day row list.

**Tasks — Month tab:** `GET /tasks/calendar` over the visible month to drive both the
grid's day-has-tasks indicator and, once a day is clicked, `renderMonthDayTasks`'s
scrollable list — no extra request on click since the month's data is already local.

**Inbox:** `GET /tasks?status=draft`. Confirm → `PATCH {status: "confirmed"}`. Reject →
`PATCH {status: "rejected"}`. Tapping a draft opens `EditTaskSheet` (title/date/time)
before confirming, matching the artifact's `editDraft`/`saveEdit` flow.

**Archive:** `GET /tasks?status=done`, grouped client-side by the date portion of
`updated_at` into "Сьогодні" / "Учора" / exact date sections (matches the artifact;
`updated_at` reflects when the task was marked done since there's no dedicated
`completed_at` column, and adding one is unnecessary here). Checkbox unchecks →
`PATCH {status: "confirmed"}`, removing it from the list.

**Settings:** `GET /auth/me` for connection state (unchanged). Google Calendar and
Telegram render through the same `IntegrationCard` component. Connect actions unchanged
(`GET /auth/google/calendar/connect` → redirect; `GET /telegram/connect` → deep link).

**Capture (voice/text):** unchanged `MediaRecorder` → `POST /transcribe` → text, and
`POST /captures` → drafts, moved from `capture/page.tsx` into
`VoiceFlow`/`TextFlow`/`ProcessingView`/`SuccessView` inside the create-flow overlay.
On success, closes the overlay and shows a snackbar pointing at Inbox (matches the
artifact; no auto-navigation away from whatever screen the user was on).

## Empty / loading / error states

Per brief section 16, each screen implements the states the artifact's "additional
states gallery" shows statically: empty Day/Inbox, loading skeletons for
timeline/Inbox, mic-permission-denied, AI-could-not-extract, no-internet, Google
Calendar connection error. These are built inline in the relevant screen/component
(e.g. `TasksDay` renders the empty-day message when its fetch resolves to zero items),
not as a separate shared "states" module — each is a small conditional render local to
where it's needed.

## Testing / verification approach

No unit test framework exists in `frontend/` today and this plan does not introduce
one. Verification is: `npm run build` and `npm run lint` clean, plus a real browser
walkthrough (dev server, browser automation) of every screen against the live backend —
golden path and the empty/error states above — per the project's standing frontend
verification expectation. Backend is untouched, so no backend test changes are needed.

## Open judgment calls made in this spec (flagged, not blocking)

- Telegram icon substituted with Lucide's `Send` (no brand glyph available).
- Archive grouping uses `updated_at` rather than adding a `completed_at` column.
- `ScheduleButton` is folded into `EditTaskSheet` rather than kept standalone.
