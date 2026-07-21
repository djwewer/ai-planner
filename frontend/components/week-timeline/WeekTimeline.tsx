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
      <div className="week-grid-columns" style={{ height: hours.length * PX_PER_HOUR }}>
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
