# Plan D: Timeline Layout Fix + Drag-to-Reschedule Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the Day-tab timeline's card-overlap bug (cards visually collide when tasks are 30+ minutes apart, a normal schedule) and add press-and-hold drag-to-reschedule on top of the fixed layout.

**Architecture:** A new pure-function layout module (`frontend/lib/timeline-layout.ts`) computes each card's position, shrinking cards to a compact single-line 28px height and splitting genuinely close-in-time tasks into a 2-column side-by-side layout instead of overlapping. `Timeline.tsx` renders from that computed layout and adds native-Pointer-Events press-and-hold dragging on top, calling the existing `PATCH /tasks/{id}` (via a new `onReschedule` prop wired in `tasks/page.tsx`) to persist the new time.

**Tech Stack:** Next.js 16 / React 19 / TypeScript frontend, no new dependencies (native Pointer Events, no drag library).

## Global Constraints

- No backend or schema changes — dragging reuses the existing `PATCH /tasks/{id} { scheduled_at }`.
- Day tab only. Week/Month tabs, and dragging across days, are out of scope.
- Only Taska-owned tasks with an existing `scheduled_at` are draggable. `gcal`-sourced items (already deduped via `google_event_id` before reaching the Timeline) are never draggable.
- No new npm dependency — implement dragging with native Pointer Events.
- No unit test framework is introduced in `frontend/` (matches this project's existing convention) — verification is `npm run build`/`npm run lint` clean plus a real browser walkthrough.
- Ukrainian-only user-facing copy; this plan adds no new user-facing copy beyond the existing time-label format already used elsewhere (`uk-UA` locale formatting).

---

### Task 1: Timeline layout fix — compact cards, collision-aware positioning

**Files:**
- Create: `frontend/lib/timeline-layout.ts`
- Modify: `frontend/components/timeline/Timeline.tsx` (full rewrite)
- Modify: `frontend/app/globals.css:84-90` (the `.event-card` block)

**Interfaces:**
- Produces: `computeLayout(items: TimelineItem[]): PositionedItem[]` where `PositionedItem = TimelineItem & { top: number; left: string; width: string }`. Also exports `PX_PER_HOUR` (64) and `START_HOUR` (0) as the single source of truth for this pixel math — Task 2 and `Timeline.tsx` both consume these instead of redefining local constants.
- Consumes: the existing `TimelineItem` type exported from `frontend/components/timeline/Timeline.tsx` (`{ time, title, source, taskId?, done? }`) — unchanged.

- [ ] **Step 1: Create the layout algorithm**

Create `frontend/lib/timeline-layout.ts`:

```ts
import type { TimelineItem } from "@/components/timeline/Timeline";

export type PositionedItem = TimelineItem & {
  top: number;
  left: string;
  width: string;
};

export const START_HOUR = 0;
export const PX_PER_HOUR = 64;
const CARD_HEIGHT = 28;
const COLUMN_WIDTH = "48%";
const COLUMN_GAP_LEFT = "52%";

function itemTop(item: TimelineItem): number {
  const d = new Date(item.time);
  const hour = d.getHours() + d.getMinutes() / 60;
  return (hour - START_HOUR) * PX_PER_HOUR;
}

/**
 * Positions timeline items by real time, but groups any items whose 28px
 * card would visually overlap the previous one into a "cluster" and splits
 * clusters into up to 2 side-by-side columns (extra rows for a 3rd+ item in
 * the same tight cluster) instead of letting them collide. Items 30+
 * minutes apart never cluster at this card height, so a normal schedule
 * renders with no special-casing.
 */
export function computeLayout(items: TimelineItem[]): PositionedItem[] {
  const sorted = [...items].sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));

  const clusters: TimelineItem[][] = [];
  let clusterEnd = -Infinity;
  for (const item of sorted) {
    const top = itemTop(item);
    if (clusters.length > 0 && top < clusterEnd) {
      clusters[clusters.length - 1].push(item);
    } else {
      clusters.push([item]);
    }
    clusterEnd = Math.max(clusterEnd, top + CARD_HEIGHT);
  }

  const positioned: PositionedItem[] = [];
  for (const cluster of clusters) {
    if (cluster.length === 1) {
      positioned.push({ ...cluster[0], top: itemTop(cluster[0]), left: "0%", width: "100%" });
      continue;
    }
    const clusterTop = itemTop(cluster[0]);
    cluster.forEach((item, i) => {
      const row = Math.floor(i / 2);
      const col = i % 2;
      positioned.push({
        ...item,
        top: clusterTop + row * CARD_HEIGHT,
        left: col === 0 ? "0%" : COLUMN_GAP_LEFT,
        width: COLUMN_WIDTH,
      });
    });
  }
  return positioned;
}
```

- [ ] **Step 2: Rewrite the Timeline component to use compact cards and the computed layout**

Replace the full contents of `frontend/components/timeline/Timeline.tsx`:

```tsx
"use client";

import { useEffect, useRef } from "react";
import { Check } from "lucide-react";
import { computeLayout, PX_PER_HOUR, START_HOUR } from "@/lib/timeline-layout";

const END_HOUR = 23;
const DEFAULT_SCROLL_HOUR = 7;

export type TimelineItem = {
  time: string;
  title: string;
  source: "taska" | "gcal";
  taskId?: number;
  done?: boolean;
};

export function Timeline({
  items,
  onToggle,
  isToday,
}: {
  items: TimelineItem[];
  onToggle: (taskId: number) => void;
  isToday: boolean;
}) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const hours = Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, i) => START_HOUR + i);
  const now = new Date();
  const nowHour = now.getHours() + now.getMinutes() / 60;
  const showNowLine = isToday;
  const scrollAnchorHour = Math.floor(isToday ? Math.max(START_HOUR, nowHour - 1) : DEFAULT_SCROLL_HOUR);
  const positionedItems = computeLayout(items);

  useEffect(() => {
    anchorRef.current?.scrollIntoView({ block: "start" });
  }, [isToday]);

  return (
    <div className="timeline-wrap">
      <div style={{ position: "relative" }}>
        {hours.map((h) => (
          <div className="hour-row" key={h} ref={h === scrollAnchorHour ? anchorRef : undefined}>
            <div className="hour-label">{String(h).padStart(2, "0")}:00</div>
            <div className="hour-line" />
          </div>
        ))}
        <div className="event-layer">
          {positionedItems.map((item, i) => {
            const d = new Date(item.time);
            const timeLabel = d.toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" });
            return (
              <div
                key={`${item.source}-${item.taskId ?? i}`}
                className={`event-card${item.source === "gcal" ? " gcal" : ""}${item.done ? " done" : ""}`}
                style={{ top: item.top, left: item.left, width: item.width }}
              >
                {item.source === "taska" && item.taskId !== undefined && (
                  <button
                    className={`checkbox${item.done ? " done" : ""}`}
                    aria-label="Позначити виконаним"
                    onClick={() => onToggle(item.taskId as number)}
                  >
                    {item.done && <Check size={12} />}
                  </button>
                )}
                <span className="ev-time">{timeLabel}</span>
                <span className="ev-title">{item.title}</span>
              </div>
            );
          })}
          {showNowLine && (
            <div className="now-line" style={{ top: (nowHour - START_HOUR) * PX_PER_HOUR }}>
              <span className="now-time">{now.toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" })}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

Note: this removes the `CalendarDays` icon import/usage (the gcal icon inside the card) — gcal items are now distinguished only by the blue left-border color, per the approved compact design (no room for an icon at 28px/single-line).

- [ ] **Step 3: Update the `.event-card` styles in `frontend/app/globals.css`**

Find this block (currently around line 84-90):

```css
.event-card { position: absolute; left: 0; right: 0; background: var(--surface); border-radius: var(--radius-md); border-left: 4px solid var(--brand); padding: 10px 12px; min-height: 52px; box-sizing: border-box; box-shadow: var(--shadow-low); display: flex; flex-direction: row; align-items: center; gap: 10px; }
.event-card.gcal { border-left-color: var(--gcal); }
.event-card .ev-body { display: flex; flex-direction: column; justify-content: center; gap: 2px; flex: 1; min-width: 0; }
.event-card .ev-title { font-size: 16px; font-weight: 600; line-height: 1.2; }
.event-card .ev-meta { font-size: 12px; color: var(--text-secondary); display: flex; align-items: center; gap: 4px; }
.event-card .ev-meta svg { width: 12px; height: 12px; }
.event-card.done .ev-title { text-decoration: line-through; color: var(--text-secondary); font-weight: 500; }
```

Replace it with:

```css
.event-card { position: absolute; background: var(--surface); border-radius: 8px; border-left: 3px solid var(--brand); padding: 0 8px; box-sizing: border-box; box-shadow: 0 1px 4px rgba(27,27,32,0.10); display: flex; flex-direction: row; align-items: center; gap: 6px; height: 28px; }
.event-card.gcal { border-left-color: var(--gcal); }
.event-card .ev-time { font-size: 11px; font-weight: 600; color: var(--text-secondary); flex-shrink: 0; }
.event-card .ev-title { font-size: 12.5px; font-weight: 600; line-height: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; min-width: 0; }
.event-card.done .ev-title { text-decoration: line-through; color: var(--text-secondary); font-weight: 500; }
```

(`left`/`right: 0` are dropped from the base rule since position is now driven per-item via the inline `left`/`width` style from `computeLayout` — a full-width item gets `left: "0%", width: "100%"` from the algorithm itself, a column-split item gets `48%`/`52%`.)

- [ ] **Step 4: Verify — build and lint**

```bash
cd frontend && npm run build && npm run lint
```

Expected: both clean, no errors.

- [ ] **Step 5: Verify in the browser**

Start the dev server (`npm run dev`) and a backend pointed at a throwaway/local DB (see any earlier task in this project's history for the pattern: sqlite `DATABASE_URL`, signup via `POST /auth/signup`, create tasks via `POST /tasks` with `deadline`+`scheduled_at` both set — tasks need `deadline` set too or they won't appear via `GET /tasks/today`). Sign in, go to Tasks → День (today), and create tasks at:
- 09:00 (isolated, should render full-width at its normal position)
- 11:00, 11:30, 12:00, 12:30, 13:00, 13:30 (the original bug report's exact scenario)
- Two tasks both at 16:00 (a genuine same-time conflict)

Confirm:
1. The 09:00 task and the 11:00-13:30 sequence all render as compact, non-overlapping single-line cards (`"11:00  Подзвонити клієнту"` style, no two-line body).
2. The two 16:00 tasks render side-by-side (2 columns), each readable.
3. Toggling done (checkbox) still works.
4. Google Calendar-synced events (if you have one connected) still show with the blue left border, no checkbox, no icon.

- [ ] **Step 6: Commit**

```bash
git add frontend/lib/timeline-layout.ts frontend/components/timeline/Timeline.tsx frontend/app/globals.css
git commit -m "fix(frontend): compact timeline cards, collision-aware layout"
```

---

### Task 2: Drag-to-reschedule

**Files:**
- Modify: `frontend/lib/timeline-layout.ts` (add drag math)
- Modify: `frontend/components/timeline/Timeline.tsx` (add pointer-event drag handling)
- Modify: `frontend/app/(app)/tasks/page.tsx` (add the reschedule handler and wire the new prop)
- Modify: `frontend/app/globals.css` (add `.dragging`/`.drag-time-label` styles, `touch-action: none` on `.event-card`)

**Interfaces:**
- Consumes: `PX_PER_HOUR`, `START_HOUR`, `computeLayout`, `PositionedItem` from Task 1's `frontend/lib/timeline-layout.ts`.
- Produces: `topToMinutes(top: number): number` and `snapTop(top: number): number` from `timeline-layout.ts`, used by both `Timeline.tsx` (live drag time-label) and `tasks/page.tsx` (converting the final drop position into a `scheduled_at` string). `Timeline`'s prop signature gains `onReschedule: (taskId: number, newTop: number) => void`.

- [ ] **Step 1: Add drag math to `frontend/lib/timeline-layout.ts`**

Append to the end of `frontend/lib/timeline-layout.ts` (after `computeLayout`):

```ts
export const SNAP_MINUTES = 15;
const MINUTES_PER_DAY = 24 * 60;

export function topToMinutes(top: number): number {
  return Math.max(0, Math.min(MINUTES_PER_DAY - 1, Math.round((top / PX_PER_HOUR) * 60)));
}

function minutesToTop(minutes: number): number {
  return (minutes / 60) * PX_PER_HOUR;
}

export function snapTop(top: number): number {
  const rawMinutes = topToMinutes(top);
  const snapped = Math.round(rawMinutes / SNAP_MINUTES) * SNAP_MINUTES;
  const clamped = Math.max(0, Math.min(MINUTES_PER_DAY - SNAP_MINUTES, snapped));
  return minutesToTop(clamped);
}
```

- [ ] **Step 2: Add press-and-hold drag handling to `Timeline.tsx`**

Replace the full contents of `frontend/components/timeline/Timeline.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { computeLayout, PX_PER_HOUR, START_HOUR, snapTop } from "@/lib/timeline-layout";

const END_HOUR = 23;
const DEFAULT_SCROLL_HOUR = 7;
const HOLD_MS = 300;
const MOVE_CANCEL_THRESHOLD = 8;

export type TimelineItem = {
  time: string;
  title: string;
  source: "taska" | "gcal";
  taskId?: number;
  done?: boolean;
};

function formatTopAsTime(top: number): string {
  const totalMinutes = Math.max(0, Math.min(24 * 60 - 1, Math.round((top / PX_PER_HOUR) * 60)));
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function Timeline({
  items,
  onToggle,
  onReschedule,
  isToday,
}: {
  items: TimelineItem[];
  onToggle: (taskId: number) => void;
  onReschedule: (taskId: number, newTop: number) => void;
  isToday: boolean;
}) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const hours = Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, i) => START_HOUR + i);
  const now = new Date();
  const nowHour = now.getHours() + now.getMinutes() / 60;
  const showNowLine = isToday;
  const scrollAnchorHour = Math.floor(isToday ? Math.max(START_HOUR, nowHour - 1) : DEFAULT_SCROLL_HOUR);
  const positionedItems = computeLayout(items);

  const [drag, setDrag] = useState<{ taskId: number; currentTop: number } | null>(null);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointerStartRef = useRef<{ x: number; y: number; top: number } | null>(null);
  const draggingRef = useRef(false);

  useEffect(() => {
    anchorRef.current?.scrollIntoView({ block: "start" });
  }, [isToday]);

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>, taskId: number, top: number) {
    const target = e.currentTarget;
    const pointerId = e.pointerId;
    pointerStartRef.current = { x: e.clientX, y: e.clientY, top };
    holdTimerRef.current = setTimeout(() => {
      draggingRef.current = true;
      target.setPointerCapture(pointerId);
      setDrag({ taskId, currentTop: top });
    }, HOLD_MS);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!pointerStartRef.current) return;
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
    setDrag((current) => (current ? { ...current, currentTop: snapTop(rawTop) } : current));
  }

  function endDrag(e: React.PointerEvent<HTMLDivElement>, commit: boolean) {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    if (draggingRef.current) {
      e.currentTarget.releasePointerCapture(e.pointerId);
      if (commit && drag) {
        const original = pointerStartRef.current?.top;
        if (original === undefined || drag.currentTop !== original) {
          onReschedule(drag.taskId, drag.currentTop);
        }
      }
    }
    pointerStartRef.current = null;
    draggingRef.current = false;
    setDrag(null);
  }

  return (
    <div className="timeline-wrap">
      <div style={{ position: "relative" }}>
        {hours.map((h) => (
          <div className="hour-row" key={h} ref={h === scrollAnchorHour ? anchorRef : undefined}>
            <div className="hour-label">{String(h).padStart(2, "0")}:00</div>
            <div className="hour-line" />
          </div>
        ))}
        <div className="event-layer">
          {positionedItems.map((item, i) => {
            const isDragging = drag?.taskId === item.taskId;
            const top = isDragging ? drag.currentTop : item.top;
            const d = new Date(item.time);
            const timeLabel = isDragging ? formatTopAsTime(top) : d.toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" });
            const draggable = item.source === "taska" && item.taskId !== undefined;
            return (
              <div
                key={`${item.source}-${item.taskId ?? i}`}
                className={`event-card${item.source === "gcal" ? " gcal" : ""}${item.done ? " done" : ""}${isDragging ? " dragging" : ""}`}
                style={{ top, left: item.left, width: item.width }}
                onPointerDown={draggable ? (e) => handlePointerDown(e, item.taskId as number, item.top) : undefined}
                onPointerMove={draggable ? handlePointerMove : undefined}
                onPointerUp={draggable ? (e) => endDrag(e, true) : undefined}
                onPointerCancel={draggable ? (e) => endDrag(e, false) : undefined}
              >
                {item.source === "taska" && item.taskId !== undefined && (
                  <button
                    className={`checkbox${item.done ? " done" : ""}`}
                    aria-label="Позначити виконаним"
                    onClick={() => onToggle(item.taskId as number)}
                  >
                    {item.done && <Check size={12} />}
                  </button>
                )}
                <span className="ev-time">{timeLabel}</span>
                <span className="ev-title">{item.title}</span>
                {isDragging && <span className="drag-time-label">{timeLabel}</span>}
              </div>
            );
          })}
          {showNowLine && (
            <div className="now-line" style={{ top: (nowHour - START_HOUR) * PX_PER_HOUR }}>
              <span className="now-time">{now.toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" })}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Wire the reschedule handler in `frontend/app/(app)/tasks/page.tsx`**

Add `topToMinutes` to the existing `@/lib/timeline-layout` import (there is no existing import from this module in this file yet — add a new one):

```tsx
import { topToMinutes } from "@/lib/timeline-layout";
```

Add this function after the existing `toggleDone` function (around line 116, right after its closing brace):

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

Update the `<Timeline>` usage (currently around line 216-224) to add the new prop:

```tsx
            {!dayLoading && timelineItems.length > 0 && (
              <Timeline
                items={timelineItems}
                isToday={isSameDay(selectedDate, new Date())}
                onToggle={(taskId) => {
                  const task = dayTasks.find((t) => t.id === taskId);
                  if (task) toggleDone(task);
                }}
                onReschedule={(taskId, newTop) => {
                  const task = dayTasks.find((t) => t.id === taskId);
                  if (task) rescheduleTask(task, newTop);
                }}
              />
            )}
```

- [ ] **Step 4: Add drag styles to `frontend/app/globals.css`**

Add `touch-action: none;` to the `.event-card` rule from Task 1 (so a press-and-hold on a card doesn't fight the browser's native scroll gesture once dragging starts):

```css
.event-card { position: absolute; background: var(--surface); border-radius: 8px; border-left: 3px solid var(--brand); padding: 0 8px; box-sizing: border-box; box-shadow: 0 1px 4px rgba(27,27,32,0.10); display: flex; flex-direction: row; align-items: center; gap: 6px; height: 28px; touch-action: none; }
```

Add these two new rules after the existing `.event-card.done .ev-title` rule:

```css
.event-card.dragging { box-shadow: 0 6px 16px rgba(27,27,32,0.20); z-index: 20; opacity: 0.95; }
.drag-time-label { position: absolute; right: 8px; top: -20px; font-size: 11px; font-weight: 700; color: #fff; background: var(--brand); padding: 2px 8px; border-radius: var(--radius-full); white-space: nowrap; }
```

- [ ] **Step 5: Verify — build and lint**

```bash
cd frontend && npm run build && npm run lint
```

Expected: both clean, no errors.

- [ ] **Step 6: Verify in the browser**

Using the same dev-server setup as Task 1's Step 5, on a device/emulator with touch (or Chrome DevTools' device-toolbar touch simulation):

1. Press and hold a task card for ~300ms, then drag it up/down — confirm it lifts (shadow), a floating time label appears showing the live snapped time, and normal quick taps/scrolls elsewhere on the timeline are unaffected.
2. Release on an empty slot — confirm the task's card moves there, and reloading the page (re-fetching from the backend) shows it persisted at the new time.
3. Drag a task and drop it exactly onto another task's time — confirm they render side-by-side (the Task 1 layout algorithm's cluster logic, unchanged) rather than one replacing the other.
4. Press and hold, drag slightly, then release back near the start position — confirm no PATCH fires (check the Network tab) and the card stays at its original time.
5. Simulate a failed PATCH (e.g. throttle to offline in devtools right after starting a drag, or temporarily stop the backend) — confirm the card reverts to its original time and the existing inline error banner appears.
6. Confirm `gcal`-sourced cards do not respond to press-and-hold at all (no drag starts).

- [ ] **Step 7: Commit**

```bash
git add frontend/lib/timeline-layout.ts frontend/components/timeline/Timeline.tsx "frontend/app/(app)/tasks/page.tsx" frontend/app/globals.css
git commit -m "feat(frontend): drag-to-reschedule tasks on the Day timeline"
```

---

## Self-Review

**Spec coverage:** compact single-line 28px cards with collision-based clustering (Task 1); 2-column side-by-side split for same-time/close-in-time conflicts with row overflow for 3+ (Task 1's `computeLayout`); press-and-hold ~300ms trigger distinguishing drag from scroll (Task 2); 15-minute snap with live time-label feedback (Task 2); optimistic update + revert-on-failure using the existing error-banner pattern (Task 2 Step 3); allow-and-split behavior when dropping onto an occupied slot (no special-casing needed — Task 1's layout algorithm already handles it); cancel-by-releasing-near-start (Task 2's `endDrag` no-ops when `currentTop === original`); GCal events never draggable (`draggable` check gates all pointer handlers) — all covered.

**Placeholder scan:** no TBD/TODO; every step has complete, runnable code.

**Type consistency:** `TimelineItem` (Task 1) is unchanged from its pre-existing shape and re-exported the same way; `PositionedItem`, `computeLayout`, `PX_PER_HOUR`, `START_HOUR` (Task 1) are consumed with matching names/types by Task 2's `Timeline.tsx` and `topToMinutes`/`snapTop` (Task 2) by both `Timeline.tsx` and `tasks/page.tsx`. `onReschedule: (taskId: number, newTop: number) => void` is defined once in Task 2 Step 2 and consumed identically in Task 2 Step 3.
