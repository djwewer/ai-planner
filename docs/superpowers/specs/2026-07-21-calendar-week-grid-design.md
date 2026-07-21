# Calendar Week Grid — Design

## Goal

Replace Calendar's Week tab — currently a flat, day-grouped list (`WeekList`) — with a Google Calendar-style time grid: 7 day-columns side by side, a shared hourly grid, tasks and Google Calendar events positioned by time within their day's column, and full drag-to-reschedule across both time and day. Recolor event/task cards from the current "white card + colored left-border stripe" style to solid pastel fills: brighter purple for the user's own tasks, blue-green/teal for Google Calendar events.

The Tasks page's own Day/Week modes (flat lists, added in a separate earlier feature) are unaffected — this change is scoped entirely to Calendar's Week tab. Calendar's Day tab (single-day `Timeline`) and Month tab (`MonthGrid` + `WeekRow` day-list) are also unaffected, except that the new pastel colors apply everywhere `.event-card` is used (i.e. the Day tab visually re-colors too, for consistency — there's no reason for Day and Week to look different).

## Why reusing `computeLayout` works unchanged

`frontend/lib/timeline-layout.ts`'s `computeLayout(items)` already returns `left`/`width` as **percentages** ("0%", "48%", "52%", "100%"), relative to whatever container the `.event-card` is absolutely positioned inside. This means a day's items can be laid out inside a narrow, single-day-width column exactly the same way they're laid out inside the full-width column today — the function needs zero changes. The week grid just needs 7 side-by-side relatively-positioned column containers, each calling `computeLayout` with only that day's items.

## Component structure

**New file:** `frontend/components/week-timeline/WeekTimeline.tsx`

Renders:
1. A day header row: 7 columns, each showing a short weekday label + date number (e.g. "Пн 20"), the current day visually highlighted (same `--brand` highlight convention already used for "today" elsewhere in the app).
2. An all-day row beneath the headers: for each day, any deadline-only tasks or all-day gcal events render as small chips (mirroring the Day tab's existing "Увесь день" treatment, just one compact row per day instead of a whole section).
3. A shared, vertically scrollable hour grid (hours 0–23, `PX_PER_HOUR` unchanged) with a left hour-label gutter (same 44px width and styling as the existing single-day `Timeline`) and 7 equal-width day-columns to its right. Each column is its own relatively-positioned container; each renders `computeLayout(dayItems)` for that day's timed items, identically to how `Timeline.tsx` does it today for a single day.
4. A "now" line, spanning the full grid width (not just one column), shown only when the current real week is displayed.

**Props:**

```ts
export type WeekTimelineItem = {
  time: string; // ISO datetime
  title: string;
  source: "tenoa" | "gcal";
  taskId?: number;
  done?: boolean;
};

export function WeekTimeline({
  weekStart,
  timedItemsByDay,
  allDayItemsByDay,
  onToggle,
  onReschedule,
  onOpenDetail,
}: {
  weekStart: Date; // Monday of the displayed week
  timedItemsByDay: WeekTimelineItem[][]; // index 0..6, Monday..Sunday
  allDayItemsByDay: WeekTimelineItem[][]; // index 0..6
  onToggle: (taskId: number) => void;
  onReschedule: (taskId: number, newDate: Date, newTop: number) => void;
  onOpenDetail: (taskId: number) => void;
})
```

`calendar/page.tsx` is responsible for bucketing `weekTasks`/`weekEvents` into these per-day arrays (all-day vs. timed, `tenoa` vs. `gcal`, excluding gcal events already synced from a Taska task) — this is the same bucketing logic the Day tab already does for a single `selectedDate`, just repeated across the week's 7 dates.

## Drag-to-reschedule across days

The existing single-day `Timeline` gesture (300ms press-and-hold arms a drag, movement before the hold cancels it, vertical movement during a drag updates a snapped `top`) is preserved and extended:

- `pointerStartRef` additionally stores the **origin day-column index** (0–6) alongside the existing `{pointerId, x, y, top, taskId}`.
- Drag state becomes `{ taskId, originDayIndex, startTop, currentTop, currentDayIndex }`.
- During `handlePointerMove`, in addition to the existing vertical delta → `currentTop` (via `snapTop`), a horizontal delta is used to compute `currentDayIndex`: measure the grid's own column width (`(gridWidth - 44) / 7`, `gridWidth` read from a ref to the grid container), then `currentDayIndex = clamp(originDayIndex + round(dx / columnWidth), 0, 6)`.
- **While dragging, the dragged card is rendered in a single floating overlay layer positioned in pixel coordinates relative to the whole grid** (`top: currentTop`, `left: 44 + currentDayIndex * columnWidth`, `width: columnWidth`) — not inside any one day's column. This sidesteps needing to recompute cross-day cluster/overlap layouts live during a drag: only the dragged card moves freely; every other (static) card keeps using the existing per-day `computeLayout` output, with the currently-dragged item's id filtered out of whichever day's item list it would otherwise appear in.
- A small label above the dragged card shows both the new time and the target day's short label (e.g. "Чт, 14:30"), extending the existing single-day drag's time-only label.
- On release: if the drag actually moved (day changed OR time changed), call `onReschedule(taskId, weekDates[currentDayIndex], currentTop)`. If it was a plain tap (never armed into a drag), call `onOpenDetail(taskId)` exactly as today's single-day tap-to-open does.

## Data flow in `calendar/page.tsx`

- Bucketing effect (existing `weekTasks`/`weekEvents` fetch is unchanged) computes `timedItemsByDay`/`allDayItemsByDay` from the current data, recomputed on every render (cheap, matches how `timelineItems` is already derived inline for the Day tab).
- A new handler, generalizing the existing single-day `rescheduleTask`, accepts an explicit target date instead of assuming the task's own current date:
  ```ts
  async function rescheduleTaskTo(task: Task, newDate: Date, newTop: number) {
    const minutes = topToMinutes(newTop);
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    const newScheduledAt = `${toDateParam(newDate)}T${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}:00`;
    // optimistic update + PATCH + rollback-on-error, applied across dayTasks/noDateTasks/weekTasks/monthTasks
    // (matching the existing cross-array-update convention already used by toggleDone/handleOpenDetail)
  }
  ```
  The Day tab's existing `Timeline` call site passes the task's own current date (`new Date(task.scheduled_at)`) so its behavior is provably unchanged; the new `WeekTimeline` passes the drag-computed date.
- `WeekList` (the flat multi-day-grouped list) becomes unused once the Week tab switches to `WeekTimeline`. `WeekRow`/`WeekItem` stay — the Month tab's day-list still uses `WeekRow` directly. The now-orphaned `WeekList` export is removed from `frontend/components/week-list/WeekList.tsx` as part of this change (it's exclusively this change that orphans it).

## Colors

Two new CSS custom properties, and `.event-card`/`.event-card.gcal` switch from a white background + colored left-border stripe to a solid pastel fill (no left border):

```css
--task-pastel: #8B7CF6;   /* brighter than --brand (#6C5CE7) */
--event-pastel: #2DD4BF;  /* blue-green/teal, replacing --gcal's blue accent */
```

```css
.event-card { background: color-mix(in srgb, var(--task-pastel) 32%, white); border-left: none; }
.event-card .ev-title, .event-card .ev-time { color: color-mix(in srgb, var(--task-pastel) 75%, black); }
.event-card.gcal { background: color-mix(in srgb, var(--event-pastel) 32%, white); }
.event-card.gcal .ev-title, .event-card.gcal .ev-time { color: color-mix(in srgb, var(--event-pastel) 75%, black); }
```

Exact percentages are a starting point — expected to be visually tuned during implementation's live-browser verification step, not treated as pixel-perfect requirements.

## Out of scope

- Tasks page's own Day/Week modes are untouched.
- No new backend endpoints — `/tasks/calendar` and `/calendar/events` already return everything needed for a week range.
- Month tab and its `WeekRow`-based day-list are untouched apart from the shared color change.
- Keyboard-based drag alternative (accessibility) — not addressed here, matches the existing single-day Timeline's scope.
