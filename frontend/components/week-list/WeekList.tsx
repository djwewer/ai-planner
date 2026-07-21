"use client";

import { Check } from "lucide-react";
import { Task, CalendarEvent } from "@/lib/types";
import { startOfWeek, toDateParam, capitalize } from "@/lib/date";

export type WeekItem = {
  time: string | null;
  title: string;
  source: "taska" | "gcal";
  taskId?: number;
  done?: boolean;
};

export function WeekRow({
  item,
  onToggle,
  onOpenDetail,
}: {
  item: WeekItem;
  onToggle: (taskId: number) => void;
  onOpenDetail: (taskId: number) => void;
}) {
  const clickable = item.source === "taska" && item.taskId !== undefined;
  return (
    <div
      className={`week-row${item.done ? " done" : ""}`}
      style={clickable ? { cursor: "pointer" } : undefined}
      onClick={clickable ? () => onOpenDetail(item.taskId as number) : undefined}
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

export function WeekList({
  tasks,
  events,
  onToggle,
  onOpenDetail,
}: {
  tasks: Task[];
  events: CalendarEvent[];
  onToggle: (taskId: number) => void;
  onOpenDetail: (taskId: number) => void;
}) {
  const start = startOfWeek(new Date());
  const syncedEventIds = new Set(tasks.map((t) => t.google_event_id).filter((id): id is string => id !== null));

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });

  return (
    <div className="section-block">
      {days.map((d) => {
        const dayKey = d.toDateString();
        const dateParam = toDateParam(d);
        const isToday = dayKey === new Date().toDateString();
        const label = capitalize(d.toLocaleDateString("uk-UA", { weekday: "short", day: "numeric", month: "long" }));

        const dayItems: WeekItem[] = [
          ...tasks
            .filter((t) => (t.scheduled_at ? new Date(t.scheduled_at).toDateString() === dayKey : t.deadline === dateParam))
            .map((t) => ({
              time: t.scheduled_at ? t.scheduled_at.slice(11, 16) : null,
              title: t.title,
              source: "taska" as const,
              taskId: t.id,
              done: t.status === "done",
            })),
          ...events
            .filter((e) => !syncedEventIds.has(e.id) && new Date(e.start).toDateString() === dayKey)
            .map((e) => ({ time: e.start.slice(11, 16), title: e.title, source: "gcal" as const })),
        ].sort((a, b) => (a.time ?? "99:99").localeCompare(b.time ?? "99:99"));

        return (
          <div className="week-day-group" key={dayKey}>
            <div className={`week-day-heading${isToday ? " is-today" : ""}`}>
              {label}{isToday ? " · сьогодні" : ""}
            </div>
            {dayItems.length === 0 && <div className="week-empty">Немає задач</div>}
            {dayItems.map((item, i) => (
              <WeekRow key={`${item.source}-${item.taskId ?? i}`} item={item} onToggle={onToggle} onOpenDetail={onOpenDetail} />
            ))}
          </div>
        );
      })}
    </div>
  );
}
