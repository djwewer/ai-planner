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
  source: "tenoa" | "gcal";
  taskId?: number;
  eventId?: string;
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
  const anchorRef = useRef<HTMLDivElement>(null);
  const hours = Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, i) => START_HOUR + i);
  const now = new Date();
  const nowHour = now.getHours() + now.getMinutes() / 60;
  const showNowLine = isToday;
  const scrollAnchorHour = Math.floor(isToday ? Math.max(START_HOUR, nowHour - 1) : DEFAULT_SCROLL_HOUR);
  const positionedItems = computeLayout(items);

  const [drag, setDrag] = useState<{ taskId: number; startTop: number; currentTop: number } | null>(null);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointerStartRef = useRef<{ pointerId: number; x: number; y: number; top: number; taskId: number } | null>(null);
  const draggingRef = useRef(false);

  useEffect(() => {
    anchorRef.current?.scrollIntoView({ block: "start" });
  }, [isToday]);

  // A single shared gesture-tracking ref only tolerates one pointer at a time — every
  // handler below ignores events from a pointerId that didn't arm the current gesture,
  // so a second simultaneous touch on another card can't corrupt or hijack it.
  function resetDragState() {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    pointerStartRef.current = null;
    draggingRef.current = false;
    setDrag(null);
  }

  // Clears a still-pending hold timer if the whole Timeline unmounts mid-hold, so its
  // callback never fires against a detached element.
  useEffect(() => resetDragState, []);

  // If the dragged task disappears from the list mid-gesture (e.g. it's toggled done
  // and refetched away, or the day changes), the card's own onLostPointerCapture never
  // fires since its DOM node is already gone — reset here instead, so pointerStartRef
  // doesn't stay armed forever and silently block every future drag.
  useEffect(() => {
    if (drag && !positionedItems.some((item) => item.taskId === drag.taskId)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      resetDragState();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positionedItems]);

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>, taskId: number, top: number) {
    if (pointerStartRef.current) return;
    const target = e.currentTarget;
    const pointerId = e.pointerId;
    pointerStartRef.current = { pointerId, x: e.clientX, y: e.clientY, top, taskId };
    holdTimerRef.current = setTimeout(() => {
      if (!target.isConnected) return;
      draggingRef.current = true;
      target.setPointerCapture(pointerId);
      const snapped = snapTop(top);
      setDrag({ taskId, startTop: snapped, currentTop: snapped });
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
    setDrag((current) => (current ? { ...current, currentTop: snapTop(rawTop) } : current));
  }

  function endDrag(e: React.PointerEvent<HTMLDivElement>, commit: boolean) {
    if (!pointerStartRef.current || e.pointerId !== pointerStartRef.current.pointerId) return;
    const wasDragging = draggingRef.current;
    const { taskId } = pointerStartRef.current;
    if (wasDragging) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    if (wasDragging && commit && drag && drag.currentTop !== drag.startTop) {
      onReschedule(drag.taskId, drag.currentTop);
    }
    if (!wasDragging && commit) {
      onOpenDetail(taskId);
    }
    resetDragState();
  }

  // Defensive cleanup: if capture is lost outside our own release call (e.g. the
  // dragged card unmounts mid-gesture because the selected date changes), make sure
  // we don't leave draggingRef/drag pointed at a task that's no longer being touched.
  function handleLostPointerCapture(e: React.PointerEvent<HTMLDivElement>) {
    if (!pointerStartRef.current || e.pointerId !== pointerStartRef.current.pointerId) return;
    resetDragState();
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
            const draggable = item.source === "tenoa" && item.taskId !== undefined;
            return (
              <div
                key={`${item.source}-${item.taskId ?? i}`}
                className={`event-card${item.source === "gcal" ? " gcal" : ""}${item.done ? " done" : ""}${isDragging ? " dragging" : ""}`}
                style={{ top, left: item.left, width: item.width }}
                onPointerDown={draggable ? (e) => handlePointerDown(e, item.taskId as number, item.top) : undefined}
                onPointerMove={draggable ? handlePointerMove : undefined}
                onPointerUp={draggable ? (e) => endDrag(e, true) : undefined}
                onPointerCancel={draggable ? (e) => endDrag(e, false) : undefined}
                onLostPointerCapture={draggable ? handleLostPointerCapture : undefined}
                onClick={
                  item.source === "gcal" && item.eventId !== undefined
                    ? () => onOpenEvent(item.eventId as string)
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
