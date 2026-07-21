# Calendar Week Grid Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Calendar's Week tab (currently a flat day-grouped list) with a Google Calendar-style time grid — 7 day-columns side by side, a shared hourly grid, tasks and Google Calendar events positioned by time and colored as pastel blocks, with full drag-to-reschedule across both time and day.

**Architecture:** A new `WeekTimeline` component renders the scrollable hour grid (7 day-columns, each independently laid out via the existing, unmodified `computeLayout` — it already returns percentage-based `left`/`width`, so a narrow per-day column positions items exactly the same way the full-width single-day `Timeline` already does). Day headers and the all-day items row are inline JSX in `calendar/page.tsx`'s sticky toolbar (matching how the Day tab's `DateStrip` is already handled there), not part of the new component. Drag-to-reschedule extends the existing press-and-hold gesture with a day-column detection step and a floating overlay for the dragged card (necessary because the dragged item is removed from its static per-day list the instant a drag begins, which would otherwise silently break the existing single-element `setPointerCapture` approach — see Task 3).

**Tech Stack:** Next.js 16 / React 19 / TypeScript, existing `frontend/lib/timeline-layout.ts` (unmodified), existing Calendar page state/fetch effects (unmodified).

## Global Constraints

- No new backend endpoints. `/tasks/calendar` and `/calendar/events` (already fetched by `calendar/page.tsx` for the Week tab) already cover everything needed for a week range.
- The Tasks page's own Day/Week modes (a separate, earlier feature) are untouched.
- Calendar's Day tab and Month tab are untouched except for the shared pastel color change (Task 1), which applies everywhere `.event-card` is used.
- The Week tab always shows the current real week (Monday–Sunday), matching the existing (pre-change) Week tab's behavior — no week navigation is being added.
- This repo has no frontend automated test runner (`package.json` only defines `build`/`lint`/`dev`/`start`). Every task's verification is `npm run build && npm run lint` plus a manual browser walkthrough.
- Colors are a starting point, not a pixel-perfect requirement — expected to be visually tuned during each task's live-browser verification step.

---

### Task 1: Pastel color tokens for event/task cards

**Files:**
- Modify: `frontend/app/globals.css`

**Interfaces:**
- Consumes: nothing.
- Produces: new CSS custom properties `--task-pastel`, `--event-pastel`; restyled `.event-card`/`.event-card.gcal` (solid pastel fill, no left-border stripe) — consumed visually by every existing and new usage of these classes (the Day tab's `Timeline`, and this plan's new `WeekTimeline`).

- [ ] **Step 1: Add the two new color tokens**

In `frontend/app/globals.css`, find:

```css
  --gcal: #4285F4;
```

Replace it with:

```css
  --gcal: #4285F4;
  --task-pastel: #8B7CF6;
  --event-pastel: #2DD4BF;
```

- [ ] **Step 2: Restyle event cards as solid pastel fills**

Find:

```css
.event-card { position: absolute; background: var(--surface); border-radius: 8px; border-left: 3px solid var(--brand); padding: 0 8px; box-sizing: border-box; box-shadow: 0 1px 4px rgba(27,27,32,0.10); display: flex; flex-direction: row; align-items: center; gap: 6px; height: 28px; touch-action: none; }
.event-card.gcal { border-left-color: var(--gcal); }
.event-card .ev-time { font-size: 11px; font-weight: 600; color: var(--text-secondary); flex-shrink: 0; }
.event-card .ev-title { font-size: 12.5px; font-weight: 600; line-height: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; min-width: 0; }
.event-card.done .ev-title { text-decoration: line-through; color: var(--text-secondary); font-weight: 500; }
```

Replace it with:

```css
.event-card { position: absolute; background: color-mix(in srgb, var(--task-pastel) 32%, white); border-radius: 8px; padding: 0 8px; box-sizing: border-box; box-shadow: 0 1px 4px rgba(27,27,32,0.10); display: flex; flex-direction: row; align-items: center; gap: 6px; height: 28px; touch-action: none; }
.event-card .ev-time { font-size: 11px; font-weight: 600; color: color-mix(in srgb, var(--task-pastel) 75%, black); flex-shrink: 0; }
.event-card .ev-title { font-size: 12.5px; font-weight: 600; line-height: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; min-width: 0; color: color-mix(in srgb, var(--task-pastel) 75%, black); }
.event-card.gcal { background: color-mix(in srgb, var(--event-pastel) 32%, white); }
.event-card.gcal .ev-time, .event-card.gcal .ev-title { color: color-mix(in srgb, var(--event-pastel) 75%, black); }
.event-card.done .ev-title { text-decoration: line-through; color: var(--text-secondary); font-weight: 500; }
```

(The `.event-card.done` rule must stay listed after the `.gcal` color rule so a done task's grey strikethrough correctly wins over the gcal teal color when both would otherwise apply — same specificity, later source order wins.)

- [ ] **Step 3: Verify — build and lint**

```bash
cd frontend && npm run build && npm run lint
```

Expected: both clean, no errors.

- [ ] **Step 4: Verify in the browser**

Start the dev server and a test backend. Go to Calendar's Day tab with at least one own task and one (unsynced) Google Calendar event visible on the timeline. Confirm: the task card is a light purple/violet pastel block with matching darker-purple text, the gcal event card is a light blue-green/teal pastel block with matching darker-teal text, and a done task still shows grey strikethrough text regardless of which pastel background it's on.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/globals.css
git commit -m "style(frontend): recolor event/task cards as pastel purple/teal fills"
```

---

### Task 2: Static week grid — component, bucketing, and wiring (no drag yet)

**Files:**
- Create: `frontend/components/week-timeline/WeekTimeline.tsx`
- Modify: `frontend/app/globals.css` (new grid-structure classes)
- Modify: `frontend/app/(app)/calendar/page.tsx` (bucketing, header/all-day JSX, swap `WeekList` for `WeekTimeline`)
- Modify: `frontend/components/week-list/WeekList.tsx` (remove the now-unused `WeekList` export; keep `WeekRow`/`WeekItem`, still used by the Month tab)

**Interfaces:**
- Consumes: `computeLayout`, `PX_PER_HOUR`, `START_HOUR` (`frontend/lib/timeline-layout.ts`, unmodified); `isSameDay` (`frontend/lib/date.ts`); `Task`/`CalendarEvent` types.
- Produces: `WeekTimelineItem` type and `WeekTimeline` component (Task 3 adds a `onReschedule` prop and drag gesture on top of this file — nothing else depends on this task's output).

- [ ] **Step 1: Create the static `WeekTimeline` component**

Create `frontend/components/week-timeline/WeekTimeline.tsx`:

```tsx
"use client";

import { useEffect, useRef } from "react";
import { Check } from "lucide-react";
import { computeLayout, PX_PER_HOUR, START_HOUR } from "@/lib/timeline-layout";
import { isSameDay } from "@/lib/date";

const END_HOUR = 23;

export type WeekTimelineItem = {
  time: string;
  title: string;
  source: "tenoa" | "gcal";
  taskId?: number;
  done?: boolean;
};

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" });
}

export function WeekTimeline({
  weekStart,
  timedItemsByDay,
  onToggle,
  onOpenDetail,
}: {
  weekStart: Date;
  timedItemsByDay: WeekTimelineItem[][];
  onToggle: (taskId: number) => void;
  onOpenDetail: (taskId: number) => void;
}) {
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    return d;
  });
  const hours = Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, i) => START_HOUR + i);
  const today = new Date();
  const now = new Date();
  const nowHour = now.getHours() + now.getMinutes() / 60;
  const showNowLine = days.some((d) => isSameDay(d, today));
  const scrollAnchorHour = Math.floor(Math.max(START_HOUR, nowHour - 1));

  const anchorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    anchorRef.current?.scrollIntoView({ block: "start" });
  }, []);

  return (
    <div className="week-grid-body">
      {hours.map((h) => (
        <div className="hour-row" key={h} ref={h === scrollAnchorHour ? anchorRef : undefined}>
          <div className="hour-label">{String(h).padStart(2, "0")}:00</div>
          <div className="hour-line" />
        </div>
      ))}
      <div className="week-grid-columns">
        {days.map((d, dayIndex) => {
          const positioned = computeLayout(timedItemsByDay[dayIndex]);
          return (
            <div className="week-grid-column" key={dayIndex}>
              {positioned.map((item, i) => (
                <div
                  key={`${item.source}-${item.taskId ?? i}`}
                  className={`event-card${item.source === "gcal" ? " gcal" : ""}${item.done ? " done" : ""}`}
                  style={{ top: item.top, left: item.left, width: item.width }}
                  onClick={
                    item.source === "tenoa" && item.taskId !== undefined
                      ? () => onOpenDetail(item.taskId as number)
                      : undefined
                  }
                >
                  {item.source === "tenoa" && item.taskId !== undefined && (
                    <button
                      className={`checkbox${item.done ? " done" : ""}`}
                      aria-label="Позначити виконаним"
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggle(item.taskId as number);
                      }}
                    >
                      {item.done && <Check size={10} />}
                    </button>
                  )}
                  <span className="ev-time">{formatTime(item.time)}</span>
                  <span className="ev-title">{item.title}</span>
                </div>
              ))}
            </div>
          );
        })}
      </div>
      {showNowLine && <div className="week-grid-now-line" style={{ top: (nowHour - START_HOUR) * PX_PER_HOUR }} />}
    </div>
  );
}
```

- [ ] **Step 2: Add the grid-structure CSS**

In `frontend/app/globals.css`, find the `/* ---------- Timeline ---------- */` section's last rule:

```css
.now-time { position: absolute; left: 4px; font-size: 11px; font-weight: 600; color: var(--brand); transform: translateY(-9px); background: var(--bg-app); padding-right: 2px; }
```

Add this immediately after it:

```css

/* ---------- Week grid ---------- */
.week-grid-header { display: flex; padding: 4px 20px 0; flex-shrink: 0; }
.week-grid-header-spacer { width: 44px; flex-shrink: 0; }
.week-grid-day-header { flex: 1; text-align: center; padding-bottom: 8px; }
.week-grid-day-header .dow { font-size: 10.5px; color: var(--text-secondary); font-weight: 500; }
.week-grid-day-header .dom { width: 26px; height: 26px; margin: 2px auto 0; display: flex; align-items: center; justify-content: center; border-radius: var(--radius-full); font-size: 13px; font-weight: 600; }
.week-grid-day-header.today .dom { background: var(--brand); color: #fff; }
.week-grid-allday { display: flex; padding: 0 20px 8px; flex-shrink: 0; background: var(--bg-app); }
.week-grid-allday-spacer { width: 44px; flex-shrink: 0; }
.week-grid-allday-col { flex: 1; padding: 0 3px; display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.week-grid-allday-chip { font-size: 10px; font-weight: 600; padding: 3px 5px; border-radius: 5px; background: color-mix(in srgb, var(--task-pastel) 32%, white); color: color-mix(in srgb, var(--task-pastel) 75%, black); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; }
.week-grid-allday-chip.gcal { background: color-mix(in srgb, var(--event-pastel) 32%, white); color: color-mix(in srgb, var(--event-pastel) 75%, black); cursor: default; }
.week-grid-body { position: relative; padding: 4px 20px 24px; }
.week-grid-columns { position: absolute; left: 44px; right: 0; top: 0; height: 100%; display: flex; }
.week-grid-column { flex: 1; position: relative; border-left: 1px solid var(--border); }
.week-grid-now-line { position: absolute; left: 44px; right: 0; height: 2px; background: var(--brand); z-index: 5; pointer-events: none; }
.week-grid-now-line::before { content: ""; position: absolute; left: -5px; top: -4px; width: 10px; height: 10px; border-radius: 50%; background: var(--brand); }
```

- [ ] **Step 3: Bucket week data per day and render the header/all-day rows in `calendar/page.tsx`**

In `frontend/app/(app)/calendar/page.tsx`, find:

```tsx
import { WeekList, WeekItem, WeekRow } from "@/components/week-list/WeekList";
```

Replace it with:

```tsx
import { WeekItem, WeekRow } from "@/components/week-list/WeekList";
import { WeekTimeline, WeekTimelineItem } from "@/components/week-timeline/WeekTimeline";
```

Find the block starting with `const syncedEventIds = new Set(dayTasks...` and ending right before the `const dayIsEmpty = ...` line:

```tsx
  const syncedEventIds = new Set(dayTasks.map((t) => t.google_event_id).filter((id): id is string => id !== null));
  const unsyncedDayEvents = dayEvents.filter((e) => !syncedEventIds.has(e.id));
  const allDayTasks = dayTasks.filter((t) => !t.scheduled_at && t.deadline);
  const allDayEvents = unsyncedDayEvents.filter((e) => e.all_day);
  const timelineItems: TimelineItem[] = [
    ...dayTasks
      .filter((t) => t.scheduled_at)
      .map((t) => ({
        time: t.scheduled_at as string,
        title: t.title,
        source: "tenoa" as const,
        taskId: t.id,
        done: t.status === "done",
      })),
    ...unsyncedDayEvents
      .filter((e) => !e.all_day)
      .map((e) => ({ time: e.start, title: e.title, source: "gcal" as const })),
  ].sort((a, b) => (a.time < b.time ? -1 : 1));
```

Replace it with (adding the week-grid bucketing right after, before `dayIsEmpty`):

```tsx
  const syncedEventIds = new Set(dayTasks.map((t) => t.google_event_id).filter((id): id is string => id !== null));
  const unsyncedDayEvents = dayEvents.filter((e) => !syncedEventIds.has(e.id));
  const allDayTasks = dayTasks.filter((t) => !t.scheduled_at && t.deadline);
  const allDayEvents = unsyncedDayEvents.filter((e) => e.all_day);
  const timelineItems: TimelineItem[] = [
    ...dayTasks
      .filter((t) => t.scheduled_at)
      .map((t) => ({
        time: t.scheduled_at as string,
        title: t.title,
        source: "tenoa" as const,
        taskId: t.id,
        done: t.status === "done",
      })),
    ...unsyncedDayEvents
      .filter((e) => !e.all_day)
      .map((e) => ({ time: e.start, title: e.title, source: "gcal" as const })),
  ].sort((a, b) => (a.time < b.time ? -1 : 1));

  const weekGridStart = startOfWeek(new Date());
  const weekGridDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekGridStart);
    d.setDate(weekGridStart.getDate() + i);
    return d;
  });
  const weekSyncedEventIds = new Set(weekTasks.map((t) => t.google_event_id).filter((id): id is string => id !== null));
  const weekUnsyncedEvents = weekEvents.filter((e) => !weekSyncedEventIds.has(e.id));
  const weekTimedItemsByDay: WeekTimelineItem[][] = weekGridDays.map((d) => {
    const dayKey = d.toDateString();
    return [
      ...weekTasks
        .filter((t) => t.scheduled_at && new Date(t.scheduled_at).toDateString() === dayKey)
        .map((t) => ({
          time: t.scheduled_at as string,
          title: t.title,
          source: "tenoa" as const,
          taskId: t.id,
          done: t.status === "done",
        })),
      ...weekUnsyncedEvents
        .filter((e) => !e.all_day && new Date(e.start).toDateString() === dayKey)
        .map((e) => ({ time: e.start, title: e.title, source: "gcal" as const })),
    ];
  });
  const weekAllDayItemsByDay: WeekTimelineItem[][] = weekGridDays.map((d) => {
    const dayKey = d.toDateString();
    const dateParam = toDateParam(d);
    return [
      ...weekTasks
        .filter((t) => !t.scheduled_at && t.deadline === dateParam)
        .map((t) => ({
          time: t.deadline as string,
          title: t.title,
          source: "tenoa" as const,
          taskId: t.id,
          done: t.status === "done",
        })),
      ...weekUnsyncedEvents
        .filter((e) => e.all_day && new Date(e.start).toDateString() === dayKey)
        .map((e) => ({ time: e.start, title: e.title, source: "gcal" as const })),
    ];
  });
```

Find:

```tsx
        {tab === "day" && <DateStrip selected={selectedDate} onSelect={setSelectedDate} />}
      </div>
```

Replace it with:

```tsx
        {tab === "day" && <DateStrip selected={selectedDate} onSelect={setSelectedDate} />}
        {tab === "week" && (
          <>
            <div className="week-grid-header">
              <div className="week-grid-header-spacer" />
              {weekGridDays.map((d, i) => {
                const isToday = isSameDay(d, new Date());
                return (
                  <div className={`week-grid-day-header${isToday ? " today" : ""}`} key={i}>
                    <div className="dow">{capitalize(d.toLocaleDateString("uk-UA", { weekday: "short" }))}</div>
                    <div className="dom">{d.getDate()}</div>
                  </div>
                );
              })}
            </div>
            {weekAllDayItemsByDay.some((items) => items.length > 0) && (
              <div className="week-grid-allday">
                <div className="week-grid-allday-spacer" />
                {weekAllDayItemsByDay.map((items, i) => (
                  <div className="week-grid-allday-col" key={i}>
                    {items.map((item, j) => (
                      <div
                        key={`${item.source}-${item.taskId ?? j}`}
                        className={`week-grid-allday-chip${item.source === "gcal" ? " gcal" : ""}`}
                        onClick={
                          item.taskId !== undefined ? () => handleOpenDetail(weekTasks.find((t) => t.id === item.taskId) as Task) : undefined
                        }
                      >
                        {item.title}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
```

Find:

```tsx
        {tab === "week" && (
          <WeekList
            tasks={weekTasks}
            events={weekEvents}
            onToggle={(taskId) => {
              const task = weekTasks.find((t) => t.id === taskId);
              if (task) toggleDone(task);
            }}
            onOpenDetail={(taskId) => {
              const task = weekTasks.find((t) => t.id === taskId);
              if (task) handleOpenDetail(task);
            }}
          />
        )}
```

Replace it with:

```tsx
        {tab === "week" && (
          <WeekTimeline
            weekStart={weekGridStart}
            timedItemsByDay={weekTimedItemsByDay}
            onToggle={(taskId) => {
              const task = weekTasks.find((t) => t.id === taskId);
              if (task) toggleDone(task);
            }}
            onOpenDetail={(taskId) => {
              const task = weekTasks.find((t) => t.id === taskId);
              if (task) handleOpenDetail(task);
            }}
          />
        )}
```

- [ ] **Step 4: Remove the now-unused `WeekList` export**

In `frontend/components/week-list/WeekList.tsx`, delete the entire `WeekList` function (the one starting `export function WeekList({ tasks, events, onToggle, onOpenDetail }...` through its closing `}`), leaving `WeekItem` and `WeekRow` in place (the Month tab's day-list still renders `WeekRow` directly). Also remove the now-unused `Task`, `CalendarEvent`, `startOfWeek`, `toDateParam` imports from that file if they become unused after deleting `WeekList` — check each one: `WeekRow` itself doesn't use `Task`/`CalendarEvent`/`startOfWeek`/`toDateParam`, so all four of those imports should be removed, leaving only `Check` (from `lucide-react`) and `capitalize` (from `@/lib/date`, still used by `WeekRow`... verify this by re-reading the file after deletion — if `capitalize` turns out to be only used inside the deleted `WeekList` function, remove it too).

- [ ] **Step 5: Verify — build and lint**

```bash
cd frontend && npm run build && npm run lint
```

Expected: both clean, no errors. Pay attention to any "unused import" lint errors from Step 4's cleanup — resolve them by removing the specific unused import, not by disabling the rule.

- [ ] **Step 6: Verify in the browser**

Start the dev server and a test backend. Create a handful of confirmed tasks on different days this week (varying times, at least one deadline-only/all-day task, at least one pair of same-time tasks on the same day to confirm side-by-side clustering still works per column) and, if a Google account is connected, at least one Google Calendar event. Go to Calendar's Week tab. Confirm: 7 day columns render with correct weekday/date headers, today is highlighted, the all-day row shows deadline-only tasks and all-day events per day, timed items are positioned by hour within their correct day's column, tasks are pastel purple and gcal events are pastel teal, tapping a task opens its detail sheet, tapping its checkbox toggles done without opening the sheet, and the Month tab still works exactly as before (uses `WeekRow` directly, untouched).

- [ ] **Step 7: Commit**

```bash
git add frontend/components/week-timeline/WeekTimeline.tsx frontend/components/week-list/WeekList.tsx frontend/app/globals.css "frontend/app/(app)/calendar/page.tsx"
git commit -m "feat(frontend): replace Calendar's Week tab with a time-grid view"
```

---

### Task 3: Cross-day drag-to-reschedule

**Files:**
- Modify: `frontend/components/week-timeline/WeekTimeline.tsx`
- Modify: `frontend/app/(app)/calendar/page.tsx`

**Interfaces:**
- Consumes: `snapTop`, `topToMinutes` (`frontend/lib/timeline-layout.ts`, unmodified).
- Produces: nothing consumed by a later task — this is the last task in this plan.

**Why the dragged card needs a floating overlay instead of the single-day `Timeline`'s approach:** the single-day `Timeline` keeps the dragged item in its normal position in the items array throughout the gesture (it just repositions that same rendered element via `isDragging` styling). This component's per-day columns, however, must stop including the dragged item in whichever day's `computeLayout` call it would otherwise belong to the moment a drag starts — otherwise a card being dragged INTO a different day would still also be rendered, stale, in its origin day's column. But the browser releases `setPointerCapture` automatically the instant its target element unmounts — so if the same element that received capture at `pointerdown` is later removed from the DOM (because Step order below causes it to be filtered out of its column once dragging begins), the browser silently drops capture and further pointermove/pointerup events stop reaching it. The fix: move the `onPointerMove`/`onPointerUp`/`onPointerCancel`/`onLostPointerCapture` handlers to the **outer grid container**, which stays mounted for the entire gesture regardless of what happens to any individual card — `onPointerDown` still fires per-card (to identify which task/day a gesture started on), but everything after that is handled by the always-present container.

- [ ] **Step 1: Add gesture state, day-column detection, and the floating drag overlay**

Replace the full contents of `frontend/components/week-timeline/WeekTimeline.tsx` with:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { computeLayout, PX_PER_HOUR, START_HOUR, snapTop } from "@/lib/timeline-layout";
import { isSameDay } from "@/lib/date";

const END_HOUR = 23;
const HOLD_MS = 300;
const MOVE_CANCEL_THRESHOLD = 8;
const LABEL_WIDTH = 44;

export type WeekTimelineItem = {
  time: string;
  title: string;
  source: "tenoa" | "gcal";
  taskId?: number;
  done?: boolean;
};

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" });
}

function formatTopAsTime(top: number): string {
  const totalMinutes = Math.max(0, Math.min(24 * 60 - 1, Math.round((top / PX_PER_HOUR) * 60)));
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function shortWeekday(d: Date): string {
  const label = d.toLocaleDateString("uk-UA", { weekday: "short" });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function WeekTimeline({
  weekStart,
  timedItemsByDay,
  onToggle,
  onReschedule,
  onOpenDetail,
}: {
  weekStart: Date;
  timedItemsByDay: WeekTimelineItem[][];
  onToggle: (taskId: number) => void;
  onReschedule: (taskId: number, newDate: Date, newTop: number) => void;
  onOpenDetail: (taskId: number) => void;
}) {
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    return d;
  });
  const hours = Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, i) => START_HOUR + i);
  const today = new Date();
  const now = new Date();
  const nowHour = now.getHours() + now.getMinutes() / 60;
  const showNowLine = days.some((d) => isSameDay(d, today));
  const scrollAnchorHour = Math.floor(Math.max(START_HOUR, nowHour - 1));

  const anchorRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    anchorRef.current?.scrollIntoView({ block: "start" });
  }, []);

  const [drag, setDrag] = useState<{
    taskId: number;
    originDayIndex: number;
    startTop: number;
    currentTop: number;
    currentDayIndex: number;
  } | null>(null);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointerStartRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
    top: number;
    taskId: number;
    dayIndex: number;
  } | null>(null);
  const draggingRef = useRef(false);

  function resetDragState() {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    pointerStartRef.current = null;
    draggingRef.current = false;
    setDrag(null);
  }

  // Clears a still-pending hold timer if the component unmounts mid-hold, so its
  // callback never fires against a detached element.
  useEffect(() => resetDragState, []);

  function columnWidth(): number {
    const gridWidth = gridRef.current?.clientWidth ?? 0;
    return Math.max(1, (gridWidth - LABEL_WIDTH) / 7);
  }

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>, taskId: number, dayIndex: number, top: number) {
    if (pointerStartRef.current) return;
    pointerStartRef.current = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, top, taskId, dayIndex };
    holdTimerRef.current = setTimeout(() => {
      draggingRef.current = true;
      const snapped = snapTop(top);
      setDrag({ taskId, originDayIndex: dayIndex, startTop: snapped, currentTop: snapped, currentDayIndex: dayIndex });
    }, HOLD_MS);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!pointerStartRef.current || e.pointerId !== pointerStartRef.current.pointerId) return;
    const dx = e.clientX - pointerStartRef.current.x;
    const dy = e.clientY - pointerStartRef.current.y;
    if (!draggingRef.current) {
      if (Math.abs(dx) > MOVE_CANCEL_THRESHOLD || Math.abs(dy) > MOVE_CANCEL_THRESHOLD) {
        if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
        pointerStartRef.current = null;
      }
      return;
    }
    e.preventDefault();
    const rawTop = pointerStartRef.current.top + dy;
    const width = columnWidth();
    const dayDelta = Math.round(dx / width);
    const nextDayIndex = Math.max(0, Math.min(6, pointerStartRef.current.dayIndex + dayDelta));
    setDrag((current) =>
      current ? { ...current, currentTop: snapTop(rawTop), currentDayIndex: nextDayIndex } : current
    );
  }

  function endDrag(e: React.PointerEvent<HTMLDivElement>, commit: boolean) {
    if (!pointerStartRef.current || e.pointerId !== pointerStartRef.current.pointerId) return;
    const wasDragging = draggingRef.current;
    const { taskId } = pointerStartRef.current;
    if (
      wasDragging &&
      commit &&
      drag &&
      (drag.currentTop !== drag.startTop || drag.currentDayIndex !== drag.originDayIndex)
    ) {
      onReschedule(drag.taskId, days[drag.currentDayIndex], drag.currentTop);
    }
    if (!wasDragging && commit) {
      onOpenDetail(taskId);
    }
    resetDragState();
  }

  // Defensive cleanup: if the week's data refetches mid-gesture and the dragged
  // task disappears, make sure pointerStartRef doesn't stay armed forever.
  useEffect(() => {
    if (drag && !timedItemsByDay.some((dayItems) => dayItems.some((item) => item.taskId === drag.taskId))) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      resetDragState();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timedItemsByDay]);

  return (
    <div
      className="week-grid-body"
      ref={gridRef}
      onPointerMove={handlePointerMove}
      onPointerUp={(e) => endDrag(e, true)}
      onPointerCancel={(e) => endDrag(e, false)}
    >
      {hours.map((h) => (
        <div className="hour-row" key={h} ref={h === scrollAnchorHour ? anchorRef : undefined}>
          <div className="hour-label">{String(h).padStart(2, "0")}:00</div>
          <div className="hour-line" />
        </div>
      ))}
      <div className="week-grid-columns">
        {days.map((d, dayIndex) => {
          const dayItems =
            drag && drag.taskId !== undefined
              ? timedItemsByDay[dayIndex].filter((item) => item.taskId !== drag.taskId)
              : timedItemsByDay[dayIndex];
          const positioned = computeLayout(dayItems);
          return (
            <div className="week-grid-column" key={dayIndex}>
              {positioned.map((item, i) => {
                const draggable = item.source === "tenoa" && item.taskId !== undefined;
                return (
                  <div
                    key={`${item.source}-${item.taskId ?? i}`}
                    className={`event-card${item.source === "gcal" ? " gcal" : ""}${item.done ? " done" : ""}`}
                    style={{ top: item.top, left: item.left, width: item.width }}
                    onPointerDown={
                      draggable
                        ? (e) => handlePointerDown(e, item.taskId as number, dayIndex, item.top)
                        : undefined
                    }
                  >
                    {item.source === "tenoa" && item.taskId !== undefined && (
                      <button
                        className={`checkbox${item.done ? " done" : ""}`}
                        aria-label="Позначити виконаним"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={() => onToggle(item.taskId as number)}
                      >
                        {item.done && <Check size={10} />}
                      </button>
                    )}
                    <span className="ev-time">{formatTime(item.time)}</span>
                    <span className="ev-title">{item.title}</span>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      {drag && (
        <div
          className="event-card dragging"
          style={{ top: drag.currentTop, left: LABEL_WIDTH + drag.currentDayIndex * columnWidth(), width: columnWidth() }}
        >
          <span className="drag-time-label">
            {shortWeekday(days[drag.currentDayIndex])}, {formatTopAsTime(drag.currentTop)}
          </span>
        </div>
      )}
      {showNowLine && <div className="week-grid-now-line" style={{ top: (nowHour - START_HOUR) * PX_PER_HOUR }} />}
    </div>
  );
}
```

- [ ] **Step 2: Generalize the reschedule handler and wire it into the week grid**

In `frontend/app/(app)/calendar/page.tsx`, find:

```tsx
  async function rescheduleTask(task: Task, newTop: number) {
    const minutes = topToMinutes(newTop);
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    const newScheduledAt = `${toDateParam(new Date(task.scheduled_at as string))}T${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}:00`;

    setError(null);
    const previousDayTasks = dayTasks;
    setDayTasks((current) => current.map((t) => (t.id === task.id ? { ...t, scheduled_at: newScheduledAt } : t)));
    try {
      const updated = await api.patch<Task>(`/tasks/${task.id}`, { scheduled_at: newScheduledAt });
      setDayTasks((current) => current.map((t) => (t.id === updated.id ? updated : t)));
    } catch (err) {
      setDayTasks(previousDayTasks);
      setError(err instanceof ApiError ? err.message : "Не вдалося перенести задачу");
    }
  }
```

Replace it with:

```tsx
  async function rescheduleTaskTo(task: Task, newDate: Date, newTop: number) {
    const minutes = topToMinutes(newTop);
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    const newScheduledAt = `${toDateParam(newDate)}T${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}:00`;

    setError(null);
    const previousDayTasks = dayTasks;
    const previousWeekTasks = weekTasks;
    const previousMonthTasks = monthTasks;
    setDayTasks((current) => current.map((t) => (t.id === task.id ? { ...t, scheduled_at: newScheduledAt } : t)));
    setWeekTasks((current) => current.map((t) => (t.id === task.id ? { ...t, scheduled_at: newScheduledAt } : t)));
    setMonthTasks((current) => current.map((t) => (t.id === task.id ? { ...t, scheduled_at: newScheduledAt } : t)));
    try {
      const updated = await api.patch<Task>(`/tasks/${task.id}`, { scheduled_at: newScheduledAt });
      setDayTasks((current) => current.map((t) => (t.id === updated.id ? updated : t)));
      setWeekTasks((current) => current.map((t) => (t.id === updated.id ? updated : t)));
      setMonthTasks((current) => current.map((t) => (t.id === updated.id ? updated : t)));
    } catch (err) {
      setDayTasks(previousDayTasks);
      setWeekTasks(previousWeekTasks);
      setMonthTasks(previousMonthTasks);
      setError(err instanceof ApiError ? err.message : "Не вдалося перенести задачу");
    }
  }
```

Find the Day tab's `<Timeline ... />` element's `onReschedule` prop:

```tsx
                onReschedule={(taskId, newTop) => {
                  const task = dayTasks.find((t) => t.id === taskId);
                  if (task) rescheduleTask(task, newTop);
                }}
```

Replace it with (same behavior — same day, only the time can change here, exactly as before):

```tsx
                onReschedule={(taskId, newTop) => {
                  const task = dayTasks.find((t) => t.id === taskId);
                  if (task) rescheduleTaskTo(task, new Date(task.scheduled_at as string), newTop);
                }}
```

Find the `<WeekTimeline ... />` element (added in Task 2):

```tsx
          <WeekTimeline
            weekStart={weekGridStart}
            timedItemsByDay={weekTimedItemsByDay}
            onToggle={(taskId) => {
              const task = weekTasks.find((t) => t.id === taskId);
              if (task) toggleDone(task);
            }}
            onOpenDetail={(taskId) => {
              const task = weekTasks.find((t) => t.id === taskId);
              if (task) handleOpenDetail(task);
            }}
          />
```

Replace it with:

```tsx
          <WeekTimeline
            weekStart={weekGridStart}
            timedItemsByDay={weekTimedItemsByDay}
            onToggle={(taskId) => {
              const task = weekTasks.find((t) => t.id === taskId);
              if (task) toggleDone(task);
            }}
            onReschedule={(taskId, newDate, newTop) => {
              const task = weekTasks.find((t) => t.id === taskId);
              if (task) rescheduleTaskTo(task, newDate, newTop);
            }}
            onOpenDetail={(taskId) => {
              const task = weekTasks.find((t) => t.id === taskId);
              if (task) handleOpenDetail(task);
            }}
          />
```

- [ ] **Step 3: Verify — build and lint**

```bash
cd frontend && npm run build && npm run lint
```

Expected: both clean, no errors.

- [ ] **Step 4: Verify in the browser**

Start the dev server and a test backend, with several confirmed tasks spread across different days/times this week. On Calendar's Week tab: quick-tap a task (no hold) — the detail sheet opens, exactly as in Task 2. Press-and-hold a task for ~300ms then drag it **vertically within the same day** — it reschedules to the new time on release, and the drag label shows the correct day+time while dragging. Press-and-hold then drag a task **horizontally into a different day's column** — on release, the task now appears on the new day at the dropped time (confirm via a page reload that it persisted correctly), and the drag label showed the correct target day while dragging. Confirm dragging a task to the row it started in (no net change) does not trigger a needless PATCH. Confirm the Day tab's own drag-to-reschedule (same-day only) still works exactly as before this task's changes.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/week-timeline/WeekTimeline.tsx "frontend/app/(app)/calendar/page.tsx"
git commit -m "feat(frontend): support dragging tasks across days in the week grid"
```

---

## Self-Review

**Spec coverage:** 7-day time-grid replacing the flat Week tab list, gcal events + tasks merged per day (Task 2); pastel purple tasks / blue-green teal gcal events, applied consistently everywhere `.event-card` renders including the unchanged Day tab (Task 1); full cross-day drag-to-reschedule, preserving the Day tab's existing same-day-only drag behavior via the generalized `rescheduleTaskTo` (Task 3); Tasks page and Month tab explicitly untouched (Task 2 Step 4 removes only the `WeekList` export, keeping `WeekRow`/`WeekItem` for the Month tab) — all covered per the design spec.

**Placeholder scan:** no TBD/TODO; every step has complete, runnable code.

**Type consistency:** `WeekTimelineItem` (Task 2 Step 1) matches the shape produced by both bucketing arrays in `calendar/page.tsx` (Task 2 Step 3: `{time, title, source, taskId?, done?}` for both `weekTimedItemsByDay`/`weekAllDayItemsByDay`). `WeekTimeline`'s props grow from `{weekStart, timedItemsByDay, onToggle, onOpenDetail}` (Task 2) to additionally include `onReschedule: (taskId: number, newDate: Date, newTop: number) => void` (Task 3), and both of `calendar/page.tsx`'s two call sites (`Timeline`'s existing `onReschedule={(taskId, newTop) => ...}` and `WeekTimeline`'s new `onReschedule={(taskId, newDate, newTop) => ...}`) correctly match their respective component's own callback signature — `Timeline.tsx` itself is never modified by this plan, so its unchanged two-argument `onReschedule` signature is deliberately preserved via the closure passing the task's own current date. `rescheduleTaskTo(task: Task, newDate: Date, newTop: number): Promise<void>` (Task 3 Step 2) is called with matching argument order/types at both of its call sites.
