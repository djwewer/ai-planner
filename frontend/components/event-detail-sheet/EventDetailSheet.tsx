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
