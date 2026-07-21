"use client";

import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { computeLayout, PX_PER_HOUR, START_HOUR, snapTop } from "@/lib/timeline-layout";
import { isSameDay } from "@/lib/date";

const END_HOUR = 23;
const HOLD_MS = 300;
const MOVE_CANCEL_THRESHOLD = 8;
// Matches globals.css's `.week-grid-columns { left: 64px; ... }` (20px body padding + 44px hour
// label) -- absolute positioning ignores the body's own padding, so this offset for the floating
// drag overlay can't be derived from the label width alone.
const GRID_LEFT_OFFSET = 64;

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
  const columnsRef = useRef<HTMLDivElement>(null);
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
    const width = columnsRef.current?.clientWidth ?? 0;
    return Math.max(1, width / 7);
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
      <div className="week-grid-columns" ref={columnsRef} style={{ height: hours.length * PX_PER_HOUR }}>
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
          // eslint-disable-next-line react-hooks/refs
          style={{ top: drag.currentTop, left: GRID_LEFT_OFFSET + drag.currentDayIndex * columnWidth(), width: columnWidth() }}
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
