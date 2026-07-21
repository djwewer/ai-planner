# Calendar Google Calendar Visibility — Design

## Goal

1. Month tab's day-list (below the month grid) currently only ever shows the user's own tasks — it never fetches or merges Google Calendar events at all, unlike the Day and Week tabs. Fix this gap so selecting a date with only Google Calendar events on it shows those events instead of an empty list.
2. Add a lightweight, read-only "view details" sheet for Google Calendar events, reachable by tapping one anywhere they appear (Day tab's timeline and all-day row, Week tab's grid and all-day row, Month tab's day-list) — title and date/time only, one "Закрити" button, no edit/delete/mark-done (editing gcal events directly is an explicitly deferred future feature, not part of this work).
3. In Month tab's day-list specifically, give each row a colored left border: purple for the user's own tasks, green/teal for Google Calendar events (reusing the `--task-pastel`/`--event-pastel` tokens already introduced for the Week grid's card colors).

## Why this needs an `eventId` field, not just reusing `taskId`

`TimelineItem` (Day tab), `WeekTimelineItem` (Week tab), and `WeekItem` (Month tab) currently carry `{time, title, source, taskId?, done?}` — a `taskId` for the user's own tasks, but *nothing* identifying which Google Calendar event a `source: "gcal"` item corresponds to. Tapping a gcal item today does nothing anywhere in the app. All three types gain an optional `eventId?: string` (the Google Calendar event's own `id`), populated only for `source: "gcal"` items, mirroring exactly how `taskId` is already populated only for `source: "tenoa"` items. Each component gets a new `onOpenEvent: (eventId: string) => void` prop (alongside the existing `onOpenDetail: (taskId: number) => void`), and `calendar/page.tsx` looks the full `CalendarEvent` up by id from whichever events array is already in memory (`dayEvents`/`weekEvents`/`monthEvents`) before opening the sheet — the exact same "carry an id, look the full object up at the call site" convention already used for tasks (`weekTasks.find(t => t.id === taskId)`).

## New pieces

**`frontend/lib/event-detail-context.tsx`** — a global context mirroring `edit-task-context.tsx`'s shape exactly, but read-only: `{ event: CalendarEvent | null; open(event): void; close(): void }`. No `onSaved`/`onDeleted` — there's nothing to save or delete.

**`frontend/components/event-detail-sheet/EventDetailSheet.tsx`** — reuses the existing `.flow`/`.flow-header`/`.flow-body` sheet chrome verbatim (same as `EditTaskSheet`/`DeleteAccountSheet`). Shows the event's title and a formatted date/time line (`22 липня, 13:00–14:00`, or `22 липня, увесь день` for all-day events), with a single "Закрити" button. Mounted once in `(app)/layout.tsx` alongside the existing `EditTaskSheet`.

## Wiring gcal taps everywhere they currently do nothing

- **Day tab timeline** (`Timeline.tsx`): timed gcal cards get a plain `onClick` (no gesture needed — gcal cards were never draggable) calling `onOpenEvent(item.eventId)`.
- **Day tab's "Увесь день" section** (inline in `calendar/page.tsx`): the all-day gcal event rows already iterate over full `CalendarEvent` objects directly (no id-lookup needed) — just add `onClick={() => handleOpenEvent(event)}`.
- **Week grid** (`WeekTimeline.tsx`): same as Day's timed cards — plain `onClick` for gcal cards.
- **Week's all-day row** (inline in `calendar/page.tsx`): currently only tenoa chips are clickable; extend to gcal chips too, looking the event up via `weekEvents.find`.
- **Month's day-list** (`WeekRow` in `WeekList.tsx`): currently only tenoa rows are `clickable`; extend to gcal rows too (now that Month actually has gcal items to show, per goal #1).

## Month tab's new Google Calendar fetch

The month fetch effect currently only calls `/tasks/calendar`. It becomes a `Promise.all` of that plus `/calendar/events` for the same month range — the exact pattern the Week tab's own fetch effect already uses. A new `monthEvents` state holds the result. `monthDayItems` gains a second source: unsynced gcal events (excluding any already represented by a synced task, via the same `google_event_id`-based exclusion Day/Week already do) landing on the selected date, interleaved with tasks and sorted by time, matching the existing sort/format conventions.

## Colors

`.week-row` gets a `border-left` driven by a new modifier class matching `item.source` (`tenoa` → `var(--task-pastel)`, `gcal` → `var(--event-pastel)`), with a small `padding-left` added so the border doesn't crowd the checkbox/dot. This only affects the Month tab, since `WeekRow`/`.week-row` has no other caller left in the codebase after the Week grid replaced the flat Week-tab list.

## Out of scope

- Editing or deleting Google Calendar events — explicitly deferred by the user ("maybe we will add this feature later").
- Drag-to-reschedule for gcal events — unchanged, still tenoa-only everywhere.
- Any backend changes — `/calendar/events` already returns everything the detail sheet needs (`id`, `title`, `start`, `end`, `all_day`).
