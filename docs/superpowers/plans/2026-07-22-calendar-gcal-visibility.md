# Calendar Google Calendar Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Month tab's day-list gains Google Calendar events (currently tasks-only, unlike Day/Week). A new read-only "view details" sheet becomes reachable by tapping any Google Calendar event anywhere it appears (Day, Week, Month) — title and time only, no edit/delete. Month's day-list rows also get a colored left border (purple for tasks, green for events).

**Architecture:** `TimelineItem`/`WeekTimelineItem`/`WeekItem` each gain an optional `eventId?: string` (populated only for `source: "gcal"` items, mirroring how `taskId` is already populated only for `source: "tenoa"` items) and a new `onOpenEvent: (eventId: string) => void` prop, alongside the existing `onOpenDetail`. A new global context (`useEventDetail`, mirroring `useEditTask`'s shape but read-only) and sheet component hold the currently-viewed `CalendarEvent`. `calendar/page.tsx` looks the full event up by id from whichever events array is already in memory before opening the sheet, exactly like it already does for tasks (`weekTasks.find(t => t.id === taskId)`).

**Tech Stack:** Next.js 16 / React 19 / TypeScript, existing `.flow`/`.flow-header`/`.flow-body` sheet chrome, existing `--task-pastel`/`--event-pastel` color tokens.

## Global Constraints

- No backend changes. `/calendar/events` already returns everything the detail sheet needs.
- The detail sheet is read-only: title + date/time, one close button. No edit fields, no delete, no mark-done — editing/deleting Google Calendar events is an explicitly deferred future feature.
- Drag-to-reschedule and mark-done remain tenoa-only everywhere; this plan only adds tap-to-view for gcal items.
- This repo has no frontend automated test runner. Every task's verification is `npm run build && npm run lint` plus a manual browser walkthrough.

---

### Task 1: Event detail sheet infrastructure + gcal tap wiring in the three list/grid components

**Files:**
- Create: `frontend/lib/event-detail-context.tsx`
- Create: `frontend/components/event-detail-sheet/EventDetailSheet.tsx`
- Modify: `frontend/app/(app)/layout.tsx`
- Modify: `frontend/components/timeline/Timeline.tsx`
- Modify: `frontend/components/week-timeline/WeekTimeline.tsx`
- Modify: `frontend/components/week-list/WeekList.tsx`
- Modify: `frontend/app/globals.css`

**Interfaces:**
- Consumes: `CalendarEvent` type (`frontend/lib/types.ts`, unmodified).
- Produces: `useEventDetail()` context (`open(event: CalendarEvent): void`, `close(): void`); `TimelineItem`/`WeekTimelineItem`/`WeekItem` each gain `eventId?: string`; `Timeline`/`WeekTimeline`/`WeekRow` each gain an `onOpenEvent: (eventId: string) => void` prop — consumed by Task 2's wiring in `calendar/page.tsx`.

- [ ] **Step 1: Create the read-only event-detail context**

Create `frontend/lib/event-detail-context.tsx`:

```tsx
"use client";

import { createContext, ReactNode, useContext, useState } from "react";
import { CalendarEvent } from "@/lib/types";

type EventDetailContextValue = {
  event: CalendarEvent | null;
  open: (event: CalendarEvent) => void;
  close: () => void;
};

const EventDetailContext = createContext<EventDetailContextValue | undefined>(undefined);

export function EventDetailProvider({ children }: { children: ReactNode }) {
  const [event, setEvent] = useState<CalendarEvent | null>(null);
  return (
    <EventDetailContext.Provider value={{ event, open: setEvent, close: () => setEvent(null) }}>
      {children}
    </EventDetailContext.Provider>
  );
}

export function useEventDetail() {
  const ctx = useContext(EventDetailContext);
  if (!ctx) throw new Error("useEventDetail must be used within EventDetailProvider");
  return ctx;
}
```

- [ ] **Step 2: Create the read-only detail sheet**

Create `frontend/components/event-detail-sheet/EventDetailSheet.tsx`:

```tsx
"use client";

import { useEventDetail } from "@/lib/event-detail-context";
import { CalendarEvent } from "@/lib/types";

function formatEventWhen(event: CalendarEvent): string {
  const start = new Date(event.start);
  const dateLabel = start.toLocaleDateString("uk-UA", { day: "numeric", month: "long" });
  if (event.all_day) return `${dateLabel}, увесь день`;
  const end = new Date(event.end);
  const startTime = start.toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" });
  const endTime = end.toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" });
  return `${dateLabel}, ${startTime}–${endTime}`;
}

export function EventDetailSheet() {
  const { event, close } = useEventDetail();

  if (!event) return null;
  return (
    <div className="flow">
      <div className="flow-header">
        <span style={{ width: 44 }} aria-hidden="true" />
        <div className="flow-title">Подія Google Calendar</div>
        <button className="text-btn" onClick={close}>Закрити</button>
      </div>
      <div className="flow-body" style={{ gap: 16 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 6 }}>{event.title}</div>
          <div style={{ fontSize: 14, color: "var(--text-secondary)" }}>{formatEventWhen(event)}</div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Mount the provider and sheet in the app layout**

In `frontend/app/(app)/layout.tsx`, find:

```tsx
import { EditTaskProvider } from "@/lib/edit-task-context";
import { EditTaskSheet } from "@/components/edit-task-sheet/EditTaskSheet";
```

Replace it with:

```tsx
import { EditTaskProvider } from "@/lib/edit-task-context";
import { EditTaskSheet } from "@/components/edit-task-sheet/EditTaskSheet";
import { EventDetailProvider } from "@/lib/event-detail-context";
import { EventDetailSheet } from "@/components/event-detail-sheet/EventDetailSheet";
```

Find:

```tsx
        <EditTaskProvider>
          <div className="app-shell">
            <div className="screen">{children}</div>
            <BottomNav inboxCount={inboxCount} />
            <CaptureFlow />
            <EditTaskSheet />
          </div>
        </EditTaskProvider>
```

Replace it with:

```tsx
        <EditTaskProvider>
          <EventDetailProvider>
            <div className="app-shell">
              <div className="screen">{children}</div>
              <BottomNav inboxCount={inboxCount} />
              <CaptureFlow />
              <EditTaskSheet />
              <EventDetailSheet />
            </div>
          </EventDetailProvider>
        </EditTaskProvider>
```

- [ ] **Step 4: Wire gcal tap-to-view into the Day tab's timeline**

In `frontend/components/timeline/Timeline.tsx`, find:

```tsx
export type TimelineItem = {
  time: string;
  title: string;
  source: "tenoa" | "gcal";
  taskId?: number;
  done?: boolean;
};
```

Replace it with:

```tsx
export type TimelineItem = {
  time: string;
  title: string;
  source: "tenoa" | "gcal";
  taskId?: number;
  eventId?: string;
  done?: boolean;
};
```

Find:

```tsx
export function Timeline({
  items,
  onToggle,
  onReschedule,
  onOpenDetail,
  isToday,
}: {
  items: TimelineItem[];
  onToggle: (taskId: number) => void;
  onReschedule: (taskId: number, newTop: number) => void;
  onOpenDetail: (taskId: number) => void;
  isToday: boolean;
}) {
```

Replace it with:

```tsx
export function Timeline({
  items,
  onToggle,
  onReschedule,
  onOpenDetail,
  onOpenEvent,
  isToday,
}: {
  items: TimelineItem[];
  onToggle: (taskId: number) => void;
  onReschedule: (taskId: number, newTop: number) => void;
  onOpenDetail: (taskId: number) => void;
  onOpenEvent: (eventId: string) => void;
  isToday: boolean;
}) {
```

Find:

```tsx
                onPointerCancel={draggable ? (e) => endDrag(e, false) : undefined}
                onLostPointerCapture={draggable ? handleLostPointerCapture : undefined}
              >
```

Replace it with:

```tsx
                onPointerCancel={draggable ? (e) => endDrag(e, false) : undefined}
                onLostPointerCapture={draggable ? handleLostPointerCapture : undefined}
                onClick={
                  item.source === "gcal" && item.eventId !== undefined
                    ? () => onOpenEvent(item.eventId as string)
                    : undefined
                }
              >
```

- [ ] **Step 5: Wire gcal tap-to-view into the Week grid**

In `frontend/components/week-timeline/WeekTimeline.tsx`, find:

```tsx
export type WeekTimelineItem = {
  time: string;
  title: string;
  source: "tenoa" | "gcal";
  taskId?: number;
  done?: boolean;
};
```

Replace it with:

```tsx
export type WeekTimelineItem = {
  time: string;
  title: string;
  source: "tenoa" | "gcal";
  taskId?: number;
  eventId?: string;
  done?: boolean;
};
```

Find:

```tsx
export function WeekTimeline({
  weekStart,
  timedItemsByDay,
  onReschedule,
  onOpenDetail,
}: {
  weekStart: Date;
  timedItemsByDay: WeekTimelineItem[][];
  onReschedule: (taskId: number, newDate: Date, newTop: number) => void;
  onOpenDetail: (taskId: number) => void;
}) {
```

Replace it with:

```tsx
export function WeekTimeline({
  weekStart,
  timedItemsByDay,
  onReschedule,
  onOpenDetail,
  onOpenEvent,
}: {
  weekStart: Date;
  timedItemsByDay: WeekTimelineItem[][];
  onReschedule: (taskId: number, newDate: Date, newTop: number) => void;
  onOpenDetail: (taskId: number) => void;
  onOpenEvent: (eventId: string) => void;
}) {
```

Find:

```tsx
                    onPointerDown={
                      draggable
                        ? (e) => handlePointerDown(e, item.taskId as number, dayIndex, item.top)
                        : undefined
                    }
                  >
                    <span className="ev-title">{item.title}</span>
                  </div>
```

Replace it with:

```tsx
                    onPointerDown={
                      draggable
                        ? (e) => handlePointerDown(e, item.taskId as number, dayIndex, item.top)
                        : undefined
                    }
                    onClick={
                      item.source === "gcal" && item.eventId !== undefined
                        ? () => onOpenEvent(item.eventId as string)
                        : undefined
                    }
                  >
                    <span className="ev-title">{item.title}</span>
                  </div>
```

- [ ] **Step 6: Make Month's day-list rows tappable for gcal items too, and add the colored left border**

In `frontend/components/week-list/WeekList.tsx`, replace the full contents with:

```tsx
"use client";

import { Check } from "lucide-react";

export type WeekItem = {
  time: string | null;
  title: string;
  source: "tenoa" | "gcal";
  taskId?: number;
  eventId?: string;
  done?: boolean;
};

export function WeekRow({
  item,
  onToggle,
  onOpenDetail,
  onOpenEvent,
}: {
  item: WeekItem;
  onToggle: (taskId: number) => void;
  onOpenDetail: (taskId: number) => void;
  onOpenEvent: (eventId: string) => void;
}) {
  const clickable =
    (item.source === "tenoa" && item.taskId !== undefined) ||
    (item.source === "gcal" && item.eventId !== undefined);

  function handleClick() {
    if (item.source === "tenoa" && item.taskId !== undefined) {
      onOpenDetail(item.taskId);
    } else if (item.source === "gcal" && item.eventId !== undefined) {
      onOpenEvent(item.eventId);
    }
  }

  return (
    <div
      className={`week-row ${item.source}${item.done ? " done" : ""}`}
      style={clickable ? { cursor: "pointer" } : undefined}
      onClick={clickable ? handleClick : undefined}
    >
      {item.source === "gcal" ? (
        <span className="source-dot gcal" />
      ) : (
        <button
          className="checkbox"
          aria-label="Позначити виконаним"
          onClick={(e) => {
            e.stopPropagation();
            onToggle(item.taskId as number);
          }}
        >
          {item.done && <Check size={10} />}
        </button>
      )}
      <span className="week-time">{item.time ?? "Увесь день"}</span>
      <span className="week-title">{item.title}</span>
    </div>
  );
}
```

- [ ] **Step 7: Add the colored left border CSS**

In `frontend/app/globals.css`, find:

```css
.week-row { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--border); }
```

Replace it with:

```css
.week-row { display: flex; align-items: center; gap: 10px; padding: 8px 0 8px 10px; border-bottom: 1px solid var(--border); border-left: 3px solid transparent; }
.week-row.tenoa { border-left-color: var(--task-pastel); }
.week-row.gcal { border-left-color: var(--event-pastel); }
```

- [ ] **Step 8: Verify — build and lint**

```bash
cd frontend && npm run build && npm run lint
```

Expected: both clean, no errors. `Timeline`, `WeekTimeline`, and `WeekRow` will show a TypeScript error at their call sites in `calendar/page.tsx` (missing the new required `onOpenEvent` prop) — that's expected and resolved by Task 2; if `npm run build` fails ONLY on that missing-prop error in `calendar/page.tsx` (not on anything in the 4 files this task actually touches), that's an acceptable, documented interim state for this task's own verification. Read the error output carefully to confirm it's exactly that and nothing else.

- [ ] **Step 9: Commit**

```bash
git add frontend/lib/event-detail-context.tsx frontend/components/event-detail-sheet/EventDetailSheet.tsx "frontend/app/(app)/layout.tsx" frontend/components/timeline/Timeline.tsx frontend/components/week-timeline/WeekTimeline.tsx frontend/components/week-list/WeekList.tsx frontend/app/globals.css
git commit -m "feat(frontend): add read-only Google Calendar event detail view"
```

---

### Task 2: Month tab Google Calendar merge + full page wiring

**Files:**
- Modify: `frontend/app/(app)/calendar/page.tsx`
- Modify: `frontend/app/globals.css`

**Interfaces:**
- Consumes: `useEventDetail()`, `Timeline`/`WeekTimeline`/`WeekRow`'s new `onOpenEvent` prop, `TimelineItem`/`WeekTimelineItem`/`WeekItem`'s new `eventId` field (all from Task 1).
- Produces: nothing consumed by a later task — this is the last task in this plan.

- [ ] **Step 1: Add `monthEvents` state and the event-detail context**

In `frontend/app/(app)/calendar/page.tsx`, find:

```tsx
import { useEditTask } from "@/lib/edit-task-context";
```

Replace it with:

```tsx
import { useEditTask } from "@/lib/edit-task-context";
import { useEventDetail } from "@/lib/event-detail-context";
```

Find:

```tsx
  const [monthTasks, setMonthTasks] = useState<Task[]>([]);
  const [error, setError] = useState<string | null>(null);
  const editTask = useEditTask();
```

Replace it with:

```tsx
  const [monthTasks, setMonthTasks] = useState<Task[]>([]);
  const [monthEvents, setMonthEvents] = useState<CalendarEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const editTask = useEditTask();
  const eventDetail = useEventDetail();
```

- [ ] **Step 2: Fetch Google Calendar events for the month too**

Find:

```tsx
  useEffect(() => {
    if (tab !== "month") return;
    const start = startOfMonth(monthCursor);
    const end = endOfMonth(monthCursor);
    api
      .get<Task[]>(`/tasks/calendar?start=${toDateParam(start)}&end=${toDateParam(end)}`)
      .then(setMonthTasks)
      .catch((err) => console.error("Failed to load month tasks", err));
  }, [tab, monthCursor]);
```

Replace it with:

```tsx
  useEffect(() => {
    if (tab !== "month") return;
    const start = startOfMonth(monthCursor);
    const end = endOfMonth(monthCursor);
    Promise.all([
      api.get<Task[]>(`/tasks/calendar?start=${toDateParam(start)}&end=${toDateParam(end)}`),
      api
        .get<{ events: CalendarEvent[] }>(`/calendar/events?start=${start.toISOString()}&end=${end.toISOString()}`)
        .then((d) => d.events)
        .catch(() => [] as CalendarEvent[]),
    ])
      .then(([t, e]) => {
        setMonthTasks(t);
        setMonthEvents(e);
      })
      .catch((err) => console.error("Failed to load month tasks", err));
  }, [tab, monthCursor]);
```

- [ ] **Step 3: Add the shared open-event handler**

Find:

```tsx
  function handleOpenDetail(task: Task) {
    editTask.open(
      task,
      (updated) => {
        setDayTasks((current) => current.map((t) => (t.id === updated.id ? updated : t)));
        setNoDateTasks((current) => current.map((t) => (t.id === updated.id ? updated : t)));
        setWeekTasks((current) => current.map((t) => (t.id === updated.id ? updated : t)));
        setMonthTasks((current) => current.map((t) => (t.id === updated.id ? updated : t)));
      },
      (deletedId) => {
        setDayTasks((current) => current.filter((t) => t.id !== deletedId));
        setNoDateTasks((current) => current.filter((t) => t.id !== deletedId));
        setWeekTasks((current) => current.filter((t) => t.id !== deletedId));
        setMonthTasks((current) => current.filter((t) => t.id !== deletedId));
      }
    );
  }
```

Replace it with:

```tsx
  function handleOpenDetail(task: Task) {
    editTask.open(
      task,
      (updated) => {
        setDayTasks((current) => current.map((t) => (t.id === updated.id ? updated : t)));
        setNoDateTasks((current) => current.map((t) => (t.id === updated.id ? updated : t)));
        setWeekTasks((current) => current.map((t) => (t.id === updated.id ? updated : t)));
        setMonthTasks((current) => current.map((t) => (t.id === updated.id ? updated : t)));
      },
      (deletedId) => {
        setDayTasks((current) => current.filter((t) => t.id !== deletedId));
        setNoDateTasks((current) => current.filter((t) => t.id !== deletedId));
        setWeekTasks((current) => current.filter((t) => t.id !== deletedId));
        setMonthTasks((current) => current.filter((t) => t.id !== deletedId));
      }
    );
  }

  function handleOpenEvent(event: CalendarEvent) {
    eventDetail.open(event);
  }
```

- [ ] **Step 4: Add `eventId` to the Day tab's timed gcal items, and wire the Day tab's taps**

Find:

```tsx
    ...unsyncedDayEvents
      .filter((e) => !e.all_day)
      .map((e) => ({ time: e.start, title: e.title, source: "gcal" as const })),
  ].sort((a, b) => (a.time < b.time ? -1 : 1));
```

Replace it with:

```tsx
    ...unsyncedDayEvents
      .filter((e) => !e.all_day)
      .map((e) => ({ time: e.start, title: e.title, source: "gcal" as const, eventId: e.id })),
  ].sort((a, b) => (a.time < b.time ? -1 : 1));
```

Find:

```tsx
                {allDayEvents.map((event) => (
                  <div className="flat-row" key={`event-${event.id}`}>
                    <div className="flat-icon gcal"><CalendarDays size={14} /></div>
                    <div className="flat-title">{event.title}</div>
                  </div>
                ))}
```

Replace it with:

```tsx
                {allDayEvents.map((event) => (
                  <div
                    className="flat-row"
                    key={`event-${event.id}`}
                    onClick={() => handleOpenEvent(event)}
                    style={{ cursor: "pointer" }}
                  >
                    <div className="flat-icon gcal"><CalendarDays size={14} /></div>
                    <div className="flat-title">{event.title}</div>
                  </div>
                ))}
```

Find:

```tsx
              <Timeline
                items={timelineItems}
                isToday={isSameDay(selectedDate, new Date())}
                onToggle={(taskId) => {
                  const task = dayTasks.find((t) => t.id === taskId);
                  if (task) toggleDone(task);
                }}
                onReschedule={(taskId, newTop) => {
                  const task = dayTasks.find((t) => t.id === taskId);
                  if (task) rescheduleTaskTo(task, new Date(task.scheduled_at as string), newTop);
                }}
                onOpenDetail={(taskId) => {
                  const task = dayTasks.find((t) => t.id === taskId);
                  if (task) handleOpenDetail(task);
                }}
              />
```

Replace it with:

```tsx
              <Timeline
                items={timelineItems}
                isToday={isSameDay(selectedDate, new Date())}
                onToggle={(taskId) => {
                  const task = dayTasks.find((t) => t.id === taskId);
                  if (task) toggleDone(task);
                }}
                onReschedule={(taskId, newTop) => {
                  const task = dayTasks.find((t) => t.id === taskId);
                  if (task) rescheduleTaskTo(task, new Date(task.scheduled_at as string), newTop);
                }}
                onOpenDetail={(taskId) => {
                  const task = dayTasks.find((t) => t.id === taskId);
                  if (task) handleOpenDetail(task);
                }}
                onOpenEvent={(eventId) => {
                  const event = dayEvents.find((e) => e.id === eventId);
                  if (event) handleOpenEvent(event);
                }}
              />
```

- [ ] **Step 5: Add `eventId` to the Week grid's gcal items (timed and all-day), and wire its taps**

Find:

```tsx
      ...weekUnsyncedEvents
        .filter((e) => !e.all_day && new Date(e.start).toDateString() === dayKey)
        .map((e) => ({ time: e.start, title: e.title, source: "gcal" as const })),
    ];
  });
  const weekAllDayItemsByDay: WeekTimelineItem[][] = weekGridDays.map((d) => {
```

Replace it with:

```tsx
      ...weekUnsyncedEvents
        .filter((e) => !e.all_day && new Date(e.start).toDateString() === dayKey)
        .map((e) => ({ time: e.start, title: e.title, source: "gcal" as const, eventId: e.id })),
    ];
  });
  const weekAllDayItemsByDay: WeekTimelineItem[][] = weekGridDays.map((d) => {
```

Find:

```tsx
      ...weekUnsyncedEvents
        .filter((e) => e.all_day && new Date(e.start).toDateString() === dayKey)
        .map((e) => ({ time: e.start, title: e.title, source: "gcal" as const })),
    ];
  });
```

Replace it with:

```tsx
      ...weekUnsyncedEvents
        .filter((e) => e.all_day && new Date(e.start).toDateString() === dayKey)
        .map((e) => ({ time: e.start, title: e.title, source: "gcal" as const, eventId: e.id })),
    ];
  });
```

Find:

```tsx
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
```

Replace it with:

```tsx
                {weekAllDayItemsByDay.map((items, i) => (
                  <div className="week-grid-allday-col" key={i}>
                    {items.map((item, j) => (
                      <div
                        key={`${item.source}-${item.taskId ?? j}`}
                        className={`week-grid-allday-chip${item.source === "gcal" ? " gcal" : ""}`}
                        onClick={() => {
                          if (item.taskId !== undefined) {
                            const task = weekTasks.find((t) => t.id === item.taskId);
                            if (task) handleOpenDetail(task);
                          } else if (item.eventId !== undefined) {
                            const event = weekEvents.find((e) => e.id === item.eventId);
                            if (event) handleOpenEvent(event);
                          }
                        }}
                      >
                        {item.title}
                      </div>
                    ))}
                  </div>
                ))}
```

Find:

```tsx
          <WeekTimeline
            weekStart={weekGridStart}
            timedItemsByDay={weekTimedItemsByDay}
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

Replace it with:

```tsx
          <WeekTimeline
            weekStart={weekGridStart}
            timedItemsByDay={weekTimedItemsByDay}
            onReschedule={(taskId, newDate, newTop) => {
              const task = weekTasks.find((t) => t.id === taskId);
              if (task) rescheduleTaskTo(task, newDate, newTop);
            }}
            onOpenDetail={(taskId) => {
              const task = weekTasks.find((t) => t.id === taskId);
              if (task) handleOpenDetail(task);
            }}
            onOpenEvent={(eventId) => {
              const event = weekEvents.find((e) => e.id === eventId);
              if (event) handleOpenEvent(event);
            }}
          />
```

- [ ] **Step 6: Merge Google Calendar events into Month's day-list, and wire its taps**

Find:

```tsx
  const monthDayItems: WeekItem[] = monthTasks
    .filter((t) =>
      t.scheduled_at ? isSameDay(new Date(t.scheduled_at), selectedMonthDate) : t.deadline === toDateParam(selectedMonthDate)
    )
    .map((t) => ({
      time: t.scheduled_at ? t.scheduled_at.slice(11, 16) : null,
      title: t.title,
      source: "tenoa" as const,
      taskId: t.id,
      done: t.status === "done",
    }))
    .sort((a, b) => (a.time ?? "99:99").localeCompare(b.time ?? "99:99"));
```

Replace it with:

```tsx
  const monthSyncedEventIds = new Set(monthTasks.map((t) => t.google_event_id).filter((id): id is string => id !== null));
  const monthUnsyncedEvents = monthEvents.filter((e) => !monthSyncedEventIds.has(e.id));

  const monthDayItems: WeekItem[] = [
    ...monthTasks
      .filter((t) =>
        t.scheduled_at ? isSameDay(new Date(t.scheduled_at), selectedMonthDate) : t.deadline === toDateParam(selectedMonthDate)
      )
      .map((t) => ({
        time: t.scheduled_at ? t.scheduled_at.slice(11, 16) : null,
        title: t.title,
        source: "tenoa" as const,
        taskId: t.id,
        done: t.status === "done",
      })),
    ...monthUnsyncedEvents
      .filter((e) => isSameDay(new Date(e.start), selectedMonthDate))
      .map((e) => ({
        time: e.all_day ? null : e.start.slice(11, 16),
        title: e.title,
        source: "gcal" as const,
        eventId: e.id,
      })),
  ].sort((a, b) => (a.time ?? "99:99").localeCompare(b.time ?? "99:99"));
```

Find:

```tsx
                  <WeekRow
                    key={`${item.source}-${item.taskId ?? i}`}
                    item={item}
                    onToggle={(taskId) => {
                      const task = monthTasks.find((t) => t.id === taskId);
                      if (task) toggleDone(task);
                    }}
                    onOpenDetail={(taskId) => {
                      const task = monthTasks.find((t) => t.id === taskId);
                      if (task) handleOpenDetail(task);
                    }}
                  />
```

Replace it with:

```tsx
                  <WeekRow
                    key={`${item.source}-${item.taskId ?? i}`}
                    item={item}
                    onToggle={(taskId) => {
                      const task = monthTasks.find((t) => t.id === taskId);
                      if (task) toggleDone(task);
                    }}
                    onOpenDetail={(taskId) => {
                      const task = monthTasks.find((t) => t.id === taskId);
                      if (task) handleOpenDetail(task);
                    }}
                    onOpenEvent={(eventId) => {
                      const event = monthEvents.find((e) => e.id === eventId);
                      if (event) handleOpenEvent(event);
                    }}
                  />
```

- [ ] **Step 7: Let gcal all-day chips in the Week tab show a pointer cursor now that they're clickable**

In `frontend/app/globals.css`, find:

```css
.week-grid-allday-chip.gcal { background: color-mix(in srgb, var(--event-pastel) 32%, white); color: color-mix(in srgb, var(--event-pastel) 75%, black); cursor: default; }
```

Replace it with:

```css
.week-grid-allday-chip.gcal { background: color-mix(in srgb, var(--event-pastel) 32%, white); color: color-mix(in srgb, var(--event-pastel) 75%, black); }
```

(It now inherits the base `.week-grid-allday-chip` rule's `cursor: pointer` instead of overriding it to `default`.)

- [ ] **Step 8: Verify — build and lint**

```bash
cd frontend && npm run build && npm run lint
```

Expected: both clean, no errors — this resolves the interim missing-prop error noted at the end of Task 1.

- [ ] **Step 9: Verify in the browser**

Start the dev server and a test backend with a connected Google account (or, if unavailable, simulate by checking network requests/state manually). Create at least one Taska task and, separately, at least one Google Calendar event that is NOT synced from a Taska task, on the same day this week.

- **Month tab**: navigate to a date with only the Google Calendar event (no Taska task) — confirm it now appears in the day-list below the grid (previously blank), with a green/teal left border; a date with only a Taska task shows it with a purple left border. Tap the gcal row — the read-only detail sheet opens showing its title and time; "Закрити" dismisses it. Tap the task row — the existing edit sheet still opens as before.
- **Week tab**: tap a Google Calendar card in the grid — the same read-only sheet opens with the correct title/time. Tap an all-day Google Calendar chip — same sheet opens. Confirm tapping a task card still opens the edit sheet, and drag-to-reschedule on a task card is unaffected.
- **Day tab**: tap a timed Google Calendar card — sheet opens. Tap an all-day Google Calendar row in "Увесь день" — sheet opens. Confirm task taps and drag-to-reschedule are unaffected.
- Confirm the detail sheet never shows any edit/delete/mark-done controls for a Google Calendar event, only the title, time, and "Закрити".

- [ ] **Step 10: Commit**

```bash
git add "frontend/app/(app)/calendar/page.tsx" frontend/app/globals.css
git commit -m "feat(frontend): merge Google Calendar events into Month view and wire event taps"
```

---

## Self-Review

**Spec coverage:** Month's day-list now fetches and merges Google Calendar events, excluding already-synced ones, matching the Day/Week exclusion pattern exactly (Task 2 Steps 2, 6); a read-only detail view (title + time, one close button, no edit/delete/mark-done) is reachable from every place a Google Calendar item appears — Day timeline, Day's all-day row, Week grid, Week's all-day row, Month's day-list (Task 1 Steps 4-6, Task 2 Steps 4-6); Month's day-list rows get a purple/green left border by source (Task 1 Step 7) — all covered per the design spec. Editing/deleting gcal events is explicitly out of scope per the spec and not present anywhere in this plan.

**Placeholder scan:** no TBD/TODO; every step has complete, runnable code.

**Type consistency:** `eventId?: string` is added identically to `TimelineItem`, `WeekTimelineItem`, and `WeekItem` (Task 1 Steps 4-6), and populated only for `source: "gcal"` items at every construction site in Task 2 (Day's `timelineItems`, Week's `weekTimedItemsByDay`/`weekAllDayItemsByDay`, Month's `monthDayItems`) — never for `source: "tenoa"` items, mirroring `taskId`'s existing tenoa-only convention exactly. `onOpenEvent: (eventId: string) => void` is added identically to `Timeline`, `WeekTimeline`, and `WeekRow`'s props (Task 1 Steps 4-6) and provided at every one of their call sites in Task 2 (Steps 4-6), each performing an id-lookup against the correct in-scope events array (`dayEvents`/`weekEvents`/`monthEvents`) before calling the shared `handleOpenEvent(event: CalendarEvent)` (Task 2 Step 3). No call site is missed — verified by cross-referencing every `<Timeline`, `<WeekTimeline`, and `<WeekRow` usage in `calendar/page.tsx` against this plan's Task 2 steps.
