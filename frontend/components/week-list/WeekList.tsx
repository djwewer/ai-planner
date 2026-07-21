"use client";

import { Check } from "lucide-react";

export type WeekItem = {
  time: string | null;
  title: string;
  source: "tenoa" | "gcal";
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
  const clickable = item.source === "tenoa" && item.taskId !== undefined;
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
