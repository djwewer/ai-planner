"use client";

import { useEffect, useState } from "react";
import { CalendarCheck2, CalendarDays, Check } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { Task, CalendarEvent } from "@/lib/types";
import { toDateParam, isSameDay, capitalize, startOfWeek, startOfMonth, endOfMonth } from "@/lib/date";
import { useEditTask } from "@/lib/edit-task-context";
import { DateStrip } from "@/components/date-strip/DateStrip";
import { Timeline, TimelineItem } from "@/components/timeline/Timeline";
import { WeekItem, WeekRow } from "@/components/week-list/WeekList";
import { WeekTimeline, WeekTimelineItem } from "@/components/week-timeline/WeekTimeline";
import { MonthGrid } from "@/components/month-grid/MonthGrid";
import { topToMinutes } from "@/lib/timeline-layout";

type Tab = "day" | "week" | "month";

function formatFullDate(d: Date): string {
  return capitalize(d.toLocaleDateString("uk-UA", { weekday: "long", day: "numeric", month: "long" }));
}

export default function CalendarPage() {
  const [tab, setTab] = useState<Tab>("day");
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [dayTasks, setDayTasks] = useState<Task[]>([]);
  const [dayEvents, setDayEvents] = useState<CalendarEvent[]>([]);
  const [noDateTasks, setNoDateTasks] = useState<Task[]>([]);
  const [dayLoading, setDayLoading] = useState(true);
  const [weekTasks, setWeekTasks] = useState<Task[]>([]);
  const [weekEvents, setWeekEvents] = useState<CalendarEvent[]>([]);
  const [monthCursor, setMonthCursor] = useState(() => startOfMonth(new Date()));
  const [selectedMonthDate, setSelectedMonthDate] = useState(new Date());
  const [monthTasks, setMonthTasks] = useState<Task[]>([]);
  const [error, setError] = useState<string | null>(null);
  const editTask = useEditTask();

  useEffect(() => {
    if (tab !== "day") return;
    let cancelled = false;
    // Resetting the loading flag per fetch (date/tab change) is the correct behavior here —
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
    ])
      .then(([fetchedTasks, fetchedEvents]) => {
        if (cancelled) return;
        setDayTasks(fetchedTasks);
        setDayEvents(fetchedEvents);
        setDayLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setDayLoading(false);
      });
    return () => {
      cancelled = true;
    };
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
    ])
      .then(([t, e]) => {
        setWeekTasks(t);
        setWeekEvents(e);
      })
      .catch((err) => console.error("Failed to load week tasks", err));
  }, [tab]);

  useEffect(() => {
    if (tab !== "month") return;
    const start = startOfMonth(monthCursor);
    const end = endOfMonth(monthCursor);
    api
      .get<Task[]>(`/tasks/calendar?start=${toDateParam(start)}&end=${toDateParam(end)}`)
      .then(setMonthTasks)
      .catch((err) => console.error("Failed to load month tasks", err));
  }, [tab, monthCursor]);

  async function toggleDone(task: Task) {
    setError(null);
    try {
      const updated = await api.patch<Task>(`/tasks/${task.id}`, {
        status: task.status === "done" ? "confirmed" : "done",
      });
      setDayTasks((current) => current.map((t) => (t.id === updated.id ? updated : t)));
      setNoDateTasks((current) => current.map((t) => (t.id === updated.id ? updated : t)));
      setWeekTasks((current) => current.map((t) => (t.id === updated.id ? updated : t)));
      setMonthTasks((current) => current.map((t) => (t.id === updated.id ? updated : t)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не вдалося оновити задачу");
    }
  }

  async function rescheduleTaskTo(task: Task, newDate: Date, newTop: number) {
    const minutes = topToMinutes(newTop);
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    const newScheduledAt = `${toDateParam(newDate)}T${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}:00`;

    setError(null);
    const previousDayTasks = dayTasks;
    const previousWeekTasks = weekTasks;
    const previousMonthTasks = monthTasks;
    setDayTasks((current) => current.map((t) => (t.id === task.id ? { ...t, scheduled_at: newScheduledAt } : t)));
    setWeekTasks((current) => current.map((t) => (t.id === task.id ? { ...t, scheduled_at: newScheduledAt } : t)));
    setMonthTasks((current) => current.map((t) => (t.id === task.id ? { ...t, scheduled_at: newScheduledAt } : t)));
    try {
      const updated = await api.patch<Task>(`/tasks/${task.id}`, { scheduled_at: newScheduledAt });
      setDayTasks((current) => current.map((t) => (t.id === updated.id ? updated : t)));
      setWeekTasks((current) => current.map((t) => (t.id === updated.id ? updated : t)));
      setMonthTasks((current) => current.map((t) => (t.id === updated.id ? updated : t)));
    } catch (err) {
      setDayTasks(previousDayTasks);
      setWeekTasks(previousWeekTasks);
      setMonthTasks(previousMonthTasks);
      setError(err instanceof ApiError ? err.message : "Не вдалося перенести задачу");
    }
  }

  function handleOpenDetail(task: Task) {
    editTask.open(
      task,
      (updated) => {
        setDayTasks((current) => current.map((t) => (t.id === updated.id ? updated : t)));
        setNoDateTasks((current) => current.map((t) => (t.id === updated.id ? updated : t)));
        setWeekTasks((current) => current.map((t) => (t.id === updated.id ? updated : t)));
        setMonthTasks((current) => current.map((t) => (t.id === updated.id ? updated : t)));
      },
      (deletedId) => {
        setDayTasks((current) => current.filter((t) => t.id !== deletedId));
        setNoDateTasks((current) => current.filter((t) => t.id !== deletedId));
        setWeekTasks((current) => current.filter((t) => t.id !== deletedId));
        setMonthTasks((current) => current.filter((t) => t.id !== deletedId));
      }
    );
  }

  const syncedEventIds = new Set(dayTasks.map((t) => t.google_event_id).filter((id): id is string => id !== null));
  const unsyncedDayEvents = dayEvents.filter((e) => !syncedEventIds.has(e.id));
  const allDayTasks = dayTasks.filter((t) => !t.scheduled_at && t.deadline);
  const allDayEvents = unsyncedDayEvents.filter((e) => e.all_day);
  const timelineItems: TimelineItem[] = [
    ...dayTasks
      .filter((t) => t.scheduled_at)
      .map((t) => ({
        time: t.scheduled_at as string,
        title: t.title,
        source: "tenoa" as const,
        taskId: t.id,
        done: t.status === "done",
      })),
    ...unsyncedDayEvents
      .filter((e) => !e.all_day)
      .map((e) => ({ time: e.start, title: e.title, source: "gcal" as const })),
  ].sort((a, b) => (a.time < b.time ? -1 : 1));

  const weekGridStart = startOfWeek(new Date());
  const weekGridDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekGridStart);
    d.setDate(weekGridStart.getDate() + i);
    return d;
  });
  const weekSyncedEventIds = new Set(weekTasks.map((t) => t.google_event_id).filter((id): id is string => id !== null));
  const weekUnsyncedEvents = weekEvents.filter((e) => !weekSyncedEventIds.has(e.id));
  const weekTimedItemsByDay: WeekTimelineItem[][] = weekGridDays.map((d) => {
    const dayKey = d.toDateString();
    return [
      ...weekTasks
        .filter((t) => t.scheduled_at && new Date(t.scheduled_at).toDateString() === dayKey)
        .map((t) => ({
          time: t.scheduled_at as string,
          title: t.title,
          source: "tenoa" as const,
          taskId: t.id,
          done: t.status === "done",
        })),
      ...weekUnsyncedEvents
        .filter((e) => !e.all_day && new Date(e.start).toDateString() === dayKey)
        .map((e) => ({ time: e.start, title: e.title, source: "gcal" as const })),
    ];
  });
  const weekAllDayItemsByDay: WeekTimelineItem[][] = weekGridDays.map((d) => {
    const dayKey = d.toDateString();
    const dateParam = toDateParam(d);
    return [
      ...weekTasks
        .filter((t) => !t.scheduled_at && t.deadline === dateParam)
        .map((t) => ({
          time: t.deadline as string,
          title: t.title,
          source: "tenoa" as const,
          taskId: t.id,
          done: t.status === "done",
        })),
      ...weekUnsyncedEvents
        .filter((e) => e.all_day && new Date(e.start).toDateString() === dayKey)
        .map((e) => ({ time: e.start, title: e.title, source: "gcal" as const })),
    ];
  });

  const dayIsEmpty =
    allDayTasks.length === 0 && allDayEvents.length === 0 && timelineItems.length === 0 && noDateTasks.length === 0;

  const monthDatesWithTasks = new Set(
    monthTasks
      .map((t) => (t.scheduled_at ? t.scheduled_at.slice(0, 10) : t.deadline))
      .filter((d): d is string => !!d)
  );

  const monthDayItems: WeekItem[] = monthTasks
    .filter((t) =>
      t.scheduled_at ? isSameDay(new Date(t.scheduled_at), selectedMonthDate) : t.deadline === toDateParam(selectedMonthDate)
    )
    .map((t) => ({
      time: t.scheduled_at ? t.scheduled_at.slice(11, 16) : null,
      title: t.title,
      source: "tenoa" as const,
      taskId: t.id,
      done: t.status === "done",
    }))
    .sort((a, b) => (a.time ?? "99:99").localeCompare(b.time ?? "99:99"));

  return (
    <>
      <div className="screen-header">
        <div>
          <h2>Календар</h2>
          <div className="date-label">{formatFullDate(selectedDate)}</div>
        </div>
      </div>
      {error && <p style={{ padding: "0 20px", color: "var(--error)", fontSize: 13 }}>{error}</p>}

      <div className="sticky-toolbar">
        <div className="view-tabs">
          <button className={`view-tab${tab === "day" ? " active" : ""}`} onClick={() => setTab("day")}>День</button>
          <button className={`view-tab${tab === "week" ? " active" : ""}`} onClick={() => setTab("week")}>Тиждень</button>
          <button className={`view-tab${tab === "month" ? " active" : ""}`} onClick={() => setTab("month")}>Місяць</button>
        </div>
        {tab === "day" && <DateStrip selected={selectedDate} onSelect={setSelectedDate} />}
        {tab === "week" && (
          <>
            <div className="week-grid-header">
              <div className="week-grid-header-spacer" />
              {weekGridDays.map((d, i) => {
                const isToday = isSameDay(d, new Date());
                return (
                  <div className={`week-grid-day-header${isToday ? " today" : ""}`} key={i}>
                    <div className="dow">{capitalize(d.toLocaleDateString("uk-UA", { weekday: "short" }))}</div>
                    <div className="dom">{d.getDate()}</div>
                  </div>
                );
              })}
            </div>
            {weekAllDayItemsByDay.some((items) => items.length > 0) && (
              <div className="week-grid-allday">
                <div className="week-grid-allday-spacer" />
                {weekAllDayItemsByDay.map((items, i) => (
                  <div className="week-grid-allday-col" key={i}>
                    {items.map((item, j) => (
                      <div
                        key={`${item.source}-${item.taskId ?? j}`}
                        className={`week-grid-allday-chip${item.source === "gcal" ? " gcal" : ""}`}
                        onClick={
                          item.taskId !== undefined ? () => handleOpenDetail(weekTasks.find((t) => t.id === item.taskId) as Task) : undefined
                        }
                      >
                        {item.title}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

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
            {!dayLoading && (allDayTasks.length > 0 || allDayEvents.length > 0) && (
              <div className="section-block">
                <div className="section-title">Увесь день</div>
                {allDayTasks.map((task) => (
                  <div className="flat-row" key={`task-${task.id}`} onClick={() => handleOpenDetail(task)}>
                    <button
                      className={`checkbox${task.status === "done" ? " done" : ""}`}
                      aria-label="Позначити виконаним"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleDone(task);
                      }}
                    >
                      {task.status === "done" && <Check size={12} />}
                    </button>
                    <div className="flat-title">{task.title}</div>
                  </div>
                ))}
                {allDayEvents.map((event) => (
                  <div className="flat-row" key={`event-${event.id}`}>
                    <div className="flat-icon gcal"><CalendarDays size={14} /></div>
                    <div className="flat-title">{event.title}</div>
                  </div>
                ))}
              </div>
            )}
            {!dayLoading && timelineItems.length > 0 && (
              <Timeline
                items={timelineItems}
                isToday={isSameDay(selectedDate, new Date())}
                onToggle={(taskId) => {
                  const task = dayTasks.find((t) => t.id === taskId);
                  if (task) toggleDone(task);
                }}
                onReschedule={(taskId, newTop) => {
                  const task = dayTasks.find((t) => t.id === taskId);
                  if (task) rescheduleTaskTo(task, new Date(task.scheduled_at as string), newTop);
                }}
                onOpenDetail={(taskId) => {
                  const task = dayTasks.find((t) => t.id === taskId);
                  if (task) handleOpenDetail(task);
                }}
              />
            )}
            {!dayLoading && noDateTasks.length > 0 && (
              <div className="section-block">
                <div className="section-title">Без дати <span className="count">— {noDateTasks.length}</span></div>
                {noDateTasks.map((task) => (
                  <div className="flat-row" key={task.id} onClick={() => handleOpenDetail(task)}>
                    <button
                      className={`checkbox${task.status === "done" ? " done" : ""}`}
                      aria-label="Позначити виконаним"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleDone(task);
                      }}
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
        {tab === "week" && (
          <WeekTimeline
            weekStart={weekGridStart}
            timedItemsByDay={weekTimedItemsByDay}
            onToggle={(taskId) => {
              const task = weekTasks.find((t) => t.id === taskId);
              if (task) toggleDone(task);
            }}
            onReschedule={(taskId, newDate, newTop) => {
              const task = weekTasks.find((t) => t.id === taskId);
              if (task) rescheduleTaskTo(task, newDate, newTop);
            }}
            onOpenDetail={(taskId) => {
              const task = weekTasks.find((t) => t.id === taskId);
              if (task) handleOpenDetail(task);
            }}
          />
        )}
        {tab === "month" && (
          <div className="section-block">
            <MonthGrid
              cursor={monthCursor}
              selected={selectedMonthDate}
              datesWithTasks={monthDatesWithTasks}
              onShift={(delta) => setMonthCursor(new Date(monthCursor.getFullYear(), monthCursor.getMonth() + delta, 1))}
              onToday={() => {
                const t = new Date();
                setMonthCursor(startOfMonth(t));
                setSelectedMonthDate(t);
              }}
              onSelect={setSelectedMonthDate}
            />
            <div className="month-day-tasks">
              <div className="section-title">
                {capitalize(selectedMonthDate.toLocaleDateString("uk-UA", { day: "numeric", month: "long", year: "numeric" }))}
              </div>
              <div className="month-day-scroll">
                {monthDayItems.length === 0 && <div className="week-empty">Немає задач на цю дату</div>}
                {monthDayItems.map((item, i) => (
                  <WeekRow
                    key={`${item.source}-${item.taskId ?? i}`}
                    item={item}
                    onToggle={(taskId) => {
                      const task = monthTasks.find((t) => t.id === taskId);
                      if (task) toggleDone(task);
                    }}
                    onOpenDetail={(taskId) => {
                      const task = monthTasks.find((t) => t.id === taskId);
                      if (task) handleOpenDetail(task);
                    }}
                  />
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
