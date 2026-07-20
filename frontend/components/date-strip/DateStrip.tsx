"use client";

const DOW = ["Нд", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];

export function DateStrip({ selected, onSelect }: { selected: Date; onSelect: (date: Date) => void }) {
  const today = new Date();
  const start = new Date(selected);
  start.setDate(start.getDate() - 3);

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });

  return (
    <div className="date-strip">
      {days.map((d) => {
        const isToday = d.toDateString() === today.toDateString();
        const isSelected = d.toDateString() === selected.toDateString();
        return (
          <button
            key={d.toISOString()}
            className={`date-chip${isToday ? " today" : ""}${isSelected ? " selected" : ""}`}
            onClick={() => onSelect(d)}
          >
            <span className="dow">{DOW[d.getDay()]}</span>
            <span className="dom">{d.getDate()}</span>
          </button>
        );
      })}
    </div>
  );
}
