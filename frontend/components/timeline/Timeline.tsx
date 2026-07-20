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

  const [drag, setDrag] = useState<{ taskId: number; startTop: number; currentTop: number } | null>(null);
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
      const snapped = snapTop(top);
      setDrag({ taskId, startTop: snapped, currentTop: snapped });
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
      if (commit && drag && drag.currentTop !== drag.startTop) {
        onReschedule(drag.taskId, drag.currentTop);
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
            const isDragging = drag !== null && drag.taskId === item.taskId;
            const top = isDragging && drag ? drag.currentTop : item.top;
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
