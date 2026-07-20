"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { Nav } from "@/components/nav";

type Task = {
  id: number;
  title: string;
  priority: number;
  deadline: string | null;
  scheduled_at: string | null;
  google_event_id: string | null;
  status: string;
};

type CalendarEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
};

type ViewMode = "day" | "week" | "month";

type TimedItem = { time: string; label: string; kind: "task" | "event" };

type DayGroup = {
  dateKey: string;
  dateLabel: string;
  allDay: Task[];
  timed: TimedItem[];
};

function startOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function endOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

function toDateParam(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateKeyOf(iso: string): string {
  return iso.slice(0, 10);
}

export default function CalendarPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [view, setView] = useState<ViewMode>("day");
  const [anchorDate, setAnchorDate] = useState(new Date());
  const [tasks, setTasks] = useState<Task[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [loading, user, router]);

  function getRange(): { start: Date; end: Date } {
    if (view === "day") {
      const start = new Date(anchorDate);
      start.setHours(0, 0, 0, 0);
      const end = new Date(anchorDate);
      end.setHours(23, 59, 59, 999);
      return { start, end };
    }
    if (view === "week") {
      const start = startOfWeek(anchorDate);
      const end = new Date(start);
      end.setDate(end.getDate() + 6);
      end.setHours(23, 59, 59, 999);
      return { start, end };
    }
    const start = startOfMonth(anchorDate);
    const end = endOfMonth(anchorDate);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }

  useEffect(() => {
    if (!user) return;
    const { start, end } = getRange();
    setError(null);
    api
      .get<Task[]>(`/tasks/calendar?start=${toDateParam(start)}&end=${toDateParam(end)}`)
      .then(setTasks)
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Не вдалося завантажити задачі")
      );
    api
      .get<{ events: CalendarEvent[] }>(
        `/calendar/events?start=${start.toISOString()}&end=${end.toISOString()}`
      )
      .then((data) => setEvents(data.events))
      .catch(() => setEvents([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, view, anchorDate]);

  function shiftAnchor(days: number) {
    const next = new Date(anchorDate);
    next.setDate(next.getDate() + days);
    setAnchorDate(next);
  }

  if (loading || !user) return <p>Завантаження…</p>;

  const groups = new Map<string, DayGroup>();
  function getGroup(dateKey: string): DayGroup {
    let group = groups.get(dateKey);
    if (!group) {
      group = {
        dateKey,
        dateLabel: new Date(dateKey).toLocaleDateString("uk-UA", {
          weekday: "short",
          day: "numeric",
          month: "short",
        }),
        allDay: [],
        timed: [],
      };
      groups.set(dateKey, group);
    }
    return group;
  }

  for (const task of tasks) {
    if (task.scheduled_at) {
      getGroup(dateKeyOf(task.scheduled_at)).timed.push({
        time: task.scheduled_at,
        label: task.title,
        kind: "task",
      });
    } else if (task.deadline) {
      getGroup(task.deadline).allDay.push(task);
    }
  }
  const syncedEventIds = new Set(
    tasks.map((task) => task.google_event_id).filter((id): id is string => id !== null)
  );
  for (const event of events) {
    if (syncedEventIds.has(event.id)) continue;
    getGroup(dateKeyOf(event.start)).timed.push({
      time: event.start,
      label: `${event.title} (Google Calendar)`,
      kind: "event",
    });
  }

  const sortedGroups = Array.from(groups.values()).sort((a, b) =>
    a.dateKey < b.dateKey ? -1 : 1
  );
  for (const group of sortedGroups) {
    group.timed.sort((a, b) => (a.time < b.time ? -1 : 1));
  }

  return (
    <main>
      <Nav />
      <h1>Календар</h1>
      {error && <p>{error}</p>}
      <div>
        <button onClick={() => setView("day")} disabled={view === "day"}>
          День
        </button>
        <button onClick={() => setView("week")} disabled={view === "week"}>
          Тиждень
        </button>
        <button onClick={() => setView("month")} disabled={view === "month"}>
          Місяць
        </button>
      </div>
      <div>
        <button onClick={() => shiftAnchor(view === "day" ? -1 : view === "week" ? -7 : -30)}>
          ← Назад
        </button>
        <span> {anchorDate.toLocaleDateString("uk-UA")} </span>
        <button onClick={() => shiftAnchor(view === "day" ? 1 : view === "week" ? 7 : 30)}>
          Вперед →
        </button>
      </div>

      {sortedGroups.length === 0 && <p>Немає задач чи подій за цей період.</p>}

      {sortedGroups.map((group) => (
        <section key={group.dateKey}>
          <h2>{group.dateLabel}</h2>
          {group.allDay.length > 0 && (
            <ul>
              {group.allDay.map((task) => (
                <li key={`allday-${task.id}`}>{task.title} (без часу)</li>
              ))}
            </ul>
          )}
          <ul>
            {group.timed.map((item, index) => (
              <li key={index}>
                {new Date(item.time).toLocaleTimeString("uk-UA", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
                {" — "}
                {item.label}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
