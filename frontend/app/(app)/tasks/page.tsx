"use client";

import { useEffect, useState } from "react";
import { CalendarCheck2, Check } from "lucide-react";
import { api } from "@/lib/api";
import { Task, CalendarEvent } from "@/lib/types";
import { toDateParam, isSameDay, capitalize, startOfWeek } from "@/lib/date";
import { DateStrip } from "@/components/date-strip/DateStrip";
import { Timeline, TimelineItem } from "@/components/timeline/Timeline";
import { WeekList } from "@/components/week-list/WeekList";

type Tab = "day" | "week" | "month";

function formatFullDate(d: Date): string {
  return capitalize(d.toLocaleDateString("uk-UA", { weekday: "long", day: "numeric", month: "long" }));
}

export default function TasksPage() {
  const [tab, setTab] = useState<Tab>("day");
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [dayTasks, setDayTasks] = useState<Task[]>([]);
  const [dayEvents, setDayEvents] = useState<CalendarEvent[]>([]);
  const [noDateTasks, setNoDateTasks] = useState<Task[]>([]);
  const [dayLoading, setDayLoading] = useState(true);
  const [weekTasks, setWeekTasks] = useState<Task[]>([]);
  const [weekEvents, setWeekEvents] = useState<CalendarEvent[]>([]);

  useEffect(() => {
    if (tab !== "day") return;
    setDayLoading(true);
    const dateParam = toDateParam(selectedDate);
    const taskRequest = isSameDay(selectedDate, new Date())
      ? api.get<Task[]>("/tasks/today")
      : api.get<Task[]>(`/tasks/calendar?start=${dateParam}&end=${dateParam}`);
    const dayStart = new Date(selectedDate);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(selectedDate);
    dayEnd.setHours(23, 59, 59, 999);
    Promise.all([
      taskRequest,
      api
        .get<{ events: CalendarEvent[] }>(`/calendar/events?start=${dayStart.toISOString()}&end=${dayEnd.toISOString()}`)
        .then((d) => d.events)
        .catch(() => [] as CalendarEvent[]),
    ]).then(([fetchedTasks, fetchedEvents]) => {
      setDayTasks(fetchedTasks);
      setDayEvents(fetchedEvents);
      setDayLoading(false);
    });
  }, [tab, selectedDate]);

  useEffect(() => {
    if (tab !== "day") return;
    api.get<Task[]>("/tasks").then((all) => setNoDateTasks(all.filter((t) => !t.deadline && !t.scheduled_at)));
  }, [tab]);

  useEffect(() => {
    if (tab !== "week") return;
    const start = startOfWeek(new Date());
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    Promise.all([
      api.get<Task[]>(`/tasks/calendar?start=${toDateParam(start)}&end=${toDateParam(end)}`),
      api
        .get<{ events: CalendarEvent[] }>(`/calendar/events?start=${start.toISOString()}&end=${end.toISOString()}`)
        .then((d) => d.events)
        .catch(() => [] as CalendarEvent[]),
    ]).then(([t, e]) => {
      setWeekTasks(t);
      setWeekEvents(e);
    });
  }, [tab]);

  async function toggleDone(task: Task) {
    const updated = await api.patch<Task>(`/tasks/${task.id}`, {
      status: task.status === "done" ? "confirmed" : "done",
    });
    setDayTasks((current) => current.map((t) => (t.id === updated.id ? updated : t)));
    setNoDateTasks((current) => current.map((t) => (t.id === updated.id ? updated : t)));
    setWeekTasks((current) => current.map((t) => (t.id === updated.id ? updated : t)));
  }

  const syncedEventIds = new Set(dayTasks.map((t) => t.google_event_id).filter((id): id is string => id !== null));
  const allDayTasks = dayTasks.filter((t) => !t.scheduled_at && t.deadline);
  const timelineItems: TimelineItem[] = [
    ...dayTasks
      .filter((t) => t.scheduled_at)
      .map((t) => ({
        time: t.scheduled_at as string,
        title: t.title,
        source: "taska" as const,
        taskId: t.id,
        done: t.status === "done",
      })),
    ...dayEvents
      .filter((e) => !syncedEventIds.has(e.id))
      .map((e) => ({ time: e.start, title: e.title, source: "gcal" as const })),
  ].sort((a, b) => (a.time < b.time ? -1 : 1));

  const dayIsEmpty = allDayTasks.length === 0 && timelineItems.length === 0 && noDateTasks.length === 0;

  return (
    <>
      <div className="screen-header">
        <div>
          <h2>Задачі</h2>
          <div className="date-label">{formatFullDate(selectedDate)}</div>
        </div>
      </div>

      <div className="view-tabs">
        <button className={`view-tab${tab === "day" ? " active" : ""}`} onClick={() => setTab("day")}>День</button>
        <button className={`view-tab${tab === "week" ? " active" : ""}`} onClick={() => setTab("week")}>Тиждень</button>
        <button className={`view-tab${tab === "month" ? " active" : ""}`} onClick={() => setTab("month")}>Місяць</button>
      </div>

      {tab === "day" && <DateStrip selected={selectedDate} onSelect={setSelectedDate} />}

      <div className="scroll">
        {tab === "day" && (
          <>
            {dayLoading && (
              <div style={{ padding: "0 20px" }}>
                <div className="skeleton-card" />
                <div className="skeleton-card" style={{ height: 36 }} />
              </div>
            )}
            {!dayLoading && dayIsEmpty && (
              <div className="empty-block">
                <div className="empty-icon"><CalendarCheck2 size={40} /></div>
                <p>На цей день нічого не заплановано.</p>
              </div>
            )}
            {!dayLoading && allDayTasks.length > 0 && (
              <div className="section-block">
                <div className="section-title">Увесь день</div>
                {allDayTasks.map((task) => (
                  <div className="flat-row" key={task.id}>
                    <button
                      className={`checkbox${task.status === "done" ? " done" : ""}`}
                      aria-label="Позначити виконаним"
                      onClick={() => toggleDone(task)}
                    >
                      {task.status === "done" && <Check size={12} />}
                    </button>
                    <div className="flat-title">{task.title}</div>
                  </div>
                ))}
              </div>
            )}
            {!dayLoading && timelineItems.length > 0 && (
              <Timeline
                items={timelineItems}
                onToggle={(taskId) => {
                  const task = dayTasks.find((t) => t.id === taskId);
                  if (task) toggleDone(task);
                }}
              />
            )}
            {!dayLoading && noDateTasks.length > 0 && (
              <div className="section-block">
                <div className="section-title">Без дати <span className="count">— {noDateTasks.length}</span></div>
                {noDateTasks.map((task) => (
                  <div className="flat-row" key={task.id}>
                    <button
                      className={`checkbox${task.status === "done" ? " done" : ""}`}
                      aria-label="Позначити виконаним"
                      onClick={() => toggleDone(task)}
                    >
                      {task.status === "done" && <Check size={12} />}
                    </button>
                    <div className="flat-title">{task.title}</div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
        {tab === "week" && <WeekList tasks={weekTasks} events={weekEvents} onToggle={(taskId) => {
          const task = weekTasks.find((t) => t.id === taskId);
          if (task) toggleDone(task);
        }} />}
        {tab === "month" && <div />}
      </div>
    </>
  );
}
