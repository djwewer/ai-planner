# Plan D: Timeline Layout Fix + Drag-to-Reschedule — Design

## Purpose

The Day tab's timeline (`frontend/components/timeline/Timeline.tsx`) positions each
task/event as an absolutely-positioned card at `top = (hour - START_HOUR) * PX_PER_HOUR`
with a fixed `height: 52` and a two-line body (title + meta row). At the current zoom
(`PX_PER_HOUR = 64`), a 30-minute gap between tasks is only 32px — less than the card's
own 52px height — so any real-world day with tasks spaced 30 minutes apart (a normal
schedule, not an edge case) renders with cards visually overlapping and their text
colliding. This plan fixes the layout and, once cards are correctly laid out, adds
drag-and-drop rescheduling on top of it — repositioning a card via drag was correctly
identified as blocked on fixing the overlap first, so the two ship together.

This spec covers Day-tab only. Week/Month tabs use a different, already-non-overlapping
row-list layout (`WeekList`/`WeekRow`, `MonthGrid`) and are unaffected.

## Current state (baseline)

- `Timeline.tsx`: renders a 24-hour (00:00–23:00) column of hour rows, plus an absolutely
  positioned `.event-layer` containing one `.event-card` per item. Each card is
  `min-height: 52px`, shows a two-line body (16px title + 12px meta row with time and,
  for `gcal`-sourced items, a small calendar icon), and a 22px checkbox for Taska-owned
  items (`source: "taska"`) to toggle done. `gcal`-sourced items (Google Calendar events
  not already synced back as a Taska task, deduped via `google_event_id`) render with a
  blue (`--gcal`) left border instead of the brand-purple one, no checkbox.
- `TimelineItem` type (exported from `Timeline.tsx`): `{ time, title, source, taskId?,
  done? }`. Built in `tasks/page.tsx` by merging `dayTasks` (with `scheduled_at`) and
  unsynced `dayEvents`, sorted by time.
- No collision handling exists today — cards simply overlap when close in time.
- No drag/gesture library is in `frontend/package.json` (only `lucide-react` beyond
  Next/React) — this plan keeps it that way, using native Pointer Events.
- Rescheduling a task today is only possible via `EditTaskSheet`'s date/time fields,
  which call `PATCH /tasks/{id}`. This plan adds a second way to do the same PATCH.

## Scope boundaries

**In scope:** the Day tab's timeline layout algorithm (fixing overlap) and drag-to-
reschedule interaction on top of it.

**Out of scope:**
- Week/Month tabs (different components, not affected by the overlap bug this way).
- Dragging a task to a different *day* — vertical drag within the currently-viewed day
  only, per the original request ("drag and drop them up and down... for day type of
  view").
- Dragging Google Calendar-synced events (`source: "gcal"`) — Taska doesn't own them.
- Drag-to-schedule an untimed task (from "Без дати" or the all-day "Увесь день"
  sections) onto the timeline — those sections are unaffected; this plan only
  repositions tasks that already have a `scheduled_at`.
- Tapping a card to open any kind of detail view — that's a separate, not-yet-designed
  plan (task detail page). In this plan, tapping a card (a *tap*, distinct from the
  press-and-hold that starts a drag) does nothing, same as today.
- Any backend or schema change — dragging calls the existing `PATCH /tasks/{id}` with a
  new `scheduled_at`, identical to what `EditTaskSheet` already sends.

## Layout algorithm

New pure-function module: `frontend/lib/timeline-layout.ts`. No React, no DOM — takes
the same `TimelineItem[]` the Timeline already receives and returns a positioned list,
so it can be reasoned about (and manually verified) independent of rendering.

```ts
export type PositionedItem = TimelineItem & {
  top: number;      // px, same coordinate space as today (START_HOUR-relative)
  left: string;      // "0%" or "0%"/"52%" for a 2-column split
  width: string;      // "100%" or "48%"
};

export function computeLayout(items: TimelineItem[]): PositionedItem[];
```

**Card size:** height drops from 52px to **28px** (fits inside a 32px 30-minute slot
at the current zoom with a small gap to spare). Title font drops from 16px to **12.5px**;
the two-line body (title line + separate meta line) collapses into **one line**:
`{time}  {title}` (e.g. `"11:00  Подзвонити клієнту"`), truncated with an ellipsis if it
doesn't fit — expected and matches Google Calendar's own compact-view behavior,
especially inside a 2-column split where each card is roughly half-width. The checkbox
(Taska-owned items only) stays at the start of the line. `gcal` items keep the blue
left-border, no checkbox, and drop the inline calendar icon (redundant with the border
color at this size).

**Conflict detection:** not exact timestamp equality — a *visual collision* check. Sort
items by time; walk the sorted list and group any items whose 28px card would overlap
the previous item's card into the same cluster (standard interval-merge: item B joins
the current cluster if `B.top < clusterEnd`, where `clusterEnd` tracks the max
`top + height` seen so far in the cluster). Two items 30+ minutes apart never cluster
(28px < 32px gap) — this is what makes the original bug report's example (tasks every
30 minutes) render correctly with no special-casing.

**Cluster resolution:**
- Cluster size 1: full width (`left: 0%`, `width: 100%`), `top` unchanged from today's
  naive `(hour - START_HOUR) * PX_PER_HOUR` formula.
- Cluster size 2+: assign items into rows of up to 2 columns each (`left: 0%`/`52%`,
  `width: 48%` each), filling left-to-right, top-to-bottom; a row's `top` is the
  cluster's starting `top` plus `28 * rowIndex`. This keeps the common case (two tasks
  at the same time — the original ask: *"if you have two events at the same time, I
  would use a side-by-side method"*) as a clean 2-column split, and degrades
  reasonably for the rare 3+-way tight cluster (extra rows) without needing a more
  elaborate bin-packing scheme.

## Drag-to-reschedule

**Trigger:** press-and-hold ~300ms on a Taska-owned, timed card starts the drag (native
Pointer Events — `onPointerDown` starts a timer; if `onPointerMove` exceeds a small
movement threshold before the timer fires, treat it as a scroll and cancel the timer,
not a drag). This avoids fighting the timeline's own vertical scroll gesture.

**During drag:** the card follows the pointer vertically (constrained to the timeline's
own bounds); the target time snaps to the nearest **15-minute** increment and is shown
in a small floating time label next to the dragged card, so the user always sees exactly
what time they're about to drop on before releasing.

**On drop:** optimistic local update (the task's `scheduled_at` changes immediately in
`tasks/page.tsx`'s `dayTasks` state, so the layout recomputes and re-renders right away)
plus a background `PATCH /tasks/{id} { scheduled_at }` call, mirroring the existing
`toggleDone` pattern in the same file. If the PATCH fails, revert `dayTasks` to the
pre-drag value and surface the existing inline error banner (same `setError` pattern
`toggleDone` already uses) — no new error UI needed.

Dropping onto a time another task already occupies is allowed and requires no special
handling: the layout algorithm above already renders same-time (or close-in-time) tasks
as a side-by-side cluster, so a drag that lands on an occupied slot just produces that
outcome naturally on the next render.

**Cancelling:** releasing back at (or very near) the original position, or attempting to
drag outside the valid 00:00–23:59 range, is a no-op — the card snaps back, no PATCH
fires.

## Testing / verification approach

Matches this project's established frontend convention (Plan 7 introduced no test
framework in `frontend/` and this plan doesn't either): `npm run build` and `npm run
lint` clean, plus a real browser walkthrough covering — the original bug report's exact
scenario (six tasks every 30 minutes, confirm no overlap); two tasks at the same time
(confirm side-by-side split); a 3-way tight cluster (confirm the extra-row fallback);
drag-and-hold to reschedule a task to an empty slot; drag-and-drop onto an occupied slot
(confirm side-by-side split appears); drag cancelled by releasing near the start position;
a failed PATCH (e.g. via devtools network throttling/offline) reverting the optimistic
move and showing the error banner.

`timeline-layout.ts` is a pure function and would be a natural candidate for real unit
tests if a frontend test runner is ever introduced — not proposed as part of this plan,
consistent with the existing no-test-framework convention.

## Open judgment calls made in this spec (flagged, not blocking)

- Cluster/conflict threshold is defined by visual collision at the new 28px card height,
  not a fixed time window — this was derived from the approved mockup rather than
  stated explicitly by the user; flagging in case the intent was a stricter "only exact
  same time" definition (in which case 3-way clusters would essentially never happen in
  practice, simplifying the resolution logic).
- The single-line compact format (`"{time}  {title}"`) and dropping the gcal calendar
  icon at this size were my own choices to fit the approved 28px/12.5px sizing, not
  explicitly specified.
