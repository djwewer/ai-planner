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
