"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { isSameDay } from "@/lib/date";

const MONTH_NAMES = [
  "Січень", "Лютий", "Березень", "Квітень", "Травень", "Червень",
  "Липень", "Серпень", "Вересень", "Жовтень", "Листопад", "Грудень",
];
const DOW_LABELS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Нд"];

export function MonthGrid({
  cursor,
  selected,
  datesWithTasks,
  onShift,
  onToday,
  onSelect,
}: {
  cursor: Date;
  selected: Date;
  datesWithTasks: Set<string>;
  onShift: (delta: number) => void;
  onToday: () => void;
  onSelect: (date: Date) => void;
}) {
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const today = new Date();
  const firstDay = new Date(year, month, 1);
  const startOffset = (firstDay.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells: (Date | null)[] = [
    ...Array.from({ length: startOffset }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => new Date(year, month, i + 1)),
  ];

  return (
    <>
      <div className="month-nav-row">
        <button className="icon-btn" aria-label="Попередній місяць" onClick={() => onShift(-1)}><ChevronLeft /></button>
        <div className="month-title">{MONTH_NAMES[month]} {year}</div>
        <button className="icon-btn" aria-label="Наступний місяць" onClick={() => onShift(1)}><ChevronRight /></button>
      </div>
      <div style={{ textAlign: "center", marginBottom: 8 }}>
        <button className="text-btn" style={{ padding: "4px 0" }} onClick={onToday}>Сьогодні</button>
      </div>
      <div className="month-grid">
        {DOW_LABELS.map((l) => (
          <div className="dow-label" key={l}>{l}</div>
        ))}
        {cells.map((date, i) => {
          if (!date) return <div key={`empty-${i}`} />;
          const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
          return (
            <button
              key={key}
              className={`day-cell${isSameDay(date, today) ? " today" : ""}${isSameDay(date, selected) ? " selected" : ""}`}
              onClick={() => onSelect(date)}
            >
              {date.getDate()}
              {datesWithTasks.has(key) && <span className="dot" />}
            </button>
          );
        })}
      </div>
    </>
  );
}
