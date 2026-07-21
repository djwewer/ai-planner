"use client";

import { useEffect, useState } from "react";
import { Check, ListChecks, Trash2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { Task } from "@/lib/types";
import { toDateParam, isSameDay, capitalize, startOfWeek } from "@/lib/date";
import { DateStrip } from "@/components/date-strip/DateStrip";
import { PRIORITY_LABELS } from "@/lib/priority";
import { useEditTask } from "@/lib/edit-task-context";

type PriorityFilter = "all" | 1 | 2 | 3 | 4;
type SortMode = "time" | "priority";
type ViewMode = "day" | "week";

function formatFullDate(d: Date): string {
  return capitalize(d.toLocaleDateString("uk-UA", { weekday: "long", day: "numeric", month: "long" }));
}

function formatTaskWhen(task: Task): string {
  if (task.scheduled_at) {
    const d = new Date(task.scheduled_at);
    const date = d.toLocaleDateString("uk-UA", { day: "numeric", month: "long" });
    const time = d.toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" });
    return `${date}, ${time}`;
  }
  if (task.deadline) {
    const d = new Date(task.deadline);
    return d.toLocaleDateString("uk-UA", { day: "numeric", month: "long" });
  }
  return "Без дати";
}

export default function TasksPage() {
  const [viewMode, setViewMode] = useState<ViewMode>("day");
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [weekTasks, setWeekTasks] = useState<Task[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>("all");
  const [sortMode, setSortMode] = useState<SortMode>("time");
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);
  const editTask = useEditTask();

  useEffect(() => {
    if (viewMode !== "day") return;
    let cancelled = false;
    // Resetting to a loading state per date change is the correct behavior here —
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTasks(null);
    const dateParam = toDateParam(selectedDate);
    const request = isSameDay(selectedDate, new Date())
      ? api.get<Task[]>("/tasks/today")
      : api.get<Task[]>(`/tasks/calendar?start=${dateParam}&end=${dateParam}`);
    request
      .then((fetched) => {
        if (cancelled) return;
        setTasks(fetched.filter((t) => t.status === "confirmed"));
      })
      .catch(() => {
        if (cancelled) return;
        setTasks([]);
      });
    return () => {
      cancelled = true;
    };
  }, [viewMode, selectedDate]);

  useEffect(() => {
    if (viewMode !== "week") return;
    let cancelled = false;
    // Resetting to a loading state on entering week mode is the correct behavior here —
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setWeekTasks(null);
    const start = startOfWeek(new Date());
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    api
      .get<Task[]>(`/tasks/calendar?start=${toDateParam(start)}&end=${toDateParam(end)}`)
      .then((fetched) => {
        if (cancelled) return;
        setWeekTasks(fetched.filter((t) => t.status === "confirmed"));
      })
      .catch(() => {
        if (cancelled) return;
        setWeekTasks([]);
      });
    return () => {
      cancelled = true;
    };
  }, [viewMode]);

  async function handleDelete(task: Task) {
    setError(null);
    try {
      await api.delete(`/tasks/${task.id}`);
      setTasks((current) => (current ?? []).filter((t) => t.id !== task.id));
      setWeekTasks((current) => (current ?? []).filter((t) => t.id !== task.id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не вдалося видалити задачу");
    } finally {
      setPendingDeleteId(null);
    }
  }

  async function handleMarkDone(task: Task) {
    setError(null);
    try {
      await api.patch<Task>(`/tasks/${task.id}`, { status: "done" });
      setTasks((current) => (current ?? []).filter((t) => t.id !== task.id));
      setWeekTasks((current) => (current ?? []).filter((t) => t.id !== task.id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не вдалося позначити задачу виконаною");
    }
  }

  function handleOpenDetail(task: Task) {
    editTask.open(
      task,
      (updated) => {
        setTasks((current) =>
          current === null
            ? current
            : current.map((t) => (t.id === updated.id ? updated : t)).filter((t) => t.status === "confirmed")
        );
        setWeekTasks((current) =>
          current === null
            ? current
            : current.map((t) => (t.id === updated.id ? updated : t)).filter((t) => t.status === "confirmed")
        );
      },
      (deletedId) => {
        setTasks((current) => (current ?? []).filter((t) => t.id !== deletedId));
        setWeekTasks((current) => (current ?? []).filter((t) => t.id !== deletedId));
      }
    );
  }

  function renderTaskRow(task: Task) {
    return (
      <div className="task-row" key={task.id} onClick={() => handleOpenDetail(task)}>
        <button
          className="checkbox"
          aria-label="Позначити виконаним"
          onClick={(e) => {
            e.stopPropagation();
            handleMarkDone(task);
          }}
        >
          <Check size={12} />
        </button>
        <div className="task-row-main">
          <div className="task-row-title">{task.title}</div>
          <div className="task-row-meta">
            <span className={`priority-pill p${task.priority}`}>{PRIORITY_LABELS[task.priority]}</span>
            <span className="task-row-when">{formatTaskWhen(task)}</span>
          </div>
        </div>
        {pendingDeleteId === task.id ? (
          <div className="task-row-confirm" onClick={(e) => e.stopPropagation()}>
            <button className="text-btn" onClick={() => setPendingDeleteId(null)}>Скасувати</button>
            <button
              className="icon-btn danger"
              aria-label="Підтвердити видалення"
              onClick={() => handleDelete(task)}
            >
              <Trash2 size={18} />
            </button>
          </div>
        ) : (
          <button
            className="icon-btn danger"
            aria-label="Видалити задачу"
            onClick={(e) => {
              e.stopPropagation();
              setPendingDeleteId(task.id);
            }}
          >
            <Trash2 size={18} />
          </button>
        )}
      </div>
    );
  }

  const filtered = (tasks ?? [])
    .filter((t) => priorityFilter === "all" || t.priority === priorityFilter)
    .sort((a, b) => {
      if (sortMode === "priority") return a.priority - b.priority;
      const aWhen = a.scheduled_at ?? a.deadline ?? "";
      const bWhen = b.scheduled_at ?? b.deadline ?? "";
      return aWhen < bWhen ? -1 : aWhen > bWhen ? 1 : 0;
    });

  const today = new Date();
  const weekStart = startOfWeek(today);
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    return d;
  });
  const weekFiltered = (weekTasks ?? []).filter((t) => priorityFilter === "all" || t.priority === priorityFilter);

  return (
    <>
      <div className="screen-header">
        <div>
          <h2>Задачі</h2>
          <div className="date-label">{viewMode === "day" ? formatFullDate(selectedDate) : "Цей тиждень"}</div>
        </div>
        <div className="mode-toggle">
          <button
            className={`mode-toggle-option${viewMode === "day" ? " active" : ""}`}
            onClick={() => setViewMode("day")}
          >
            День
          </button>
          <button
            className={`mode-toggle-option${viewMode === "week" ? " active" : ""}`}
            onClick={() => setViewMode("week")}
          >
            Тиждень
          </button>
        </div>
      </div>
      {error && <p style={{ padding: "0 20px", color: "var(--error)", fontSize: 13 }}>{error}</p>}

      <div className="sticky-toolbar">
        {viewMode === "day" && <DateStrip selected={selectedDate} onSelect={setSelectedDate} />}
        <div className="task-filters">
          <div className="filter-chips">
            <button
              className={`filter-chip${priorityFilter === "all" ? " active" : ""}`}
              onClick={() => setPriorityFilter("all")}
            >
              Усі
            </button>
            {([1, 2, 3, 4] as const).map((p) => (
              <button
                key={p}
                className={`filter-chip${priorityFilter === p ? " active" : ""}`}
                onClick={() => setPriorityFilter(p)}
              >
                {PRIORITY_LABELS[p]}
              </button>
            ))}
          </div>
          {viewMode === "day" && (
            <div className="sort-toggle">
              <button
                className={`sort-option${sortMode === "time" ? " active" : ""}`}
                onClick={() => setSortMode("time")}
              >
                За часом
              </button>
              <button
                className={`sort-option${sortMode === "priority" ? " active" : ""}`}
                onClick={() => setSortMode("priority")}
              >
                За пріоритетом
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="scroll">
        {viewMode === "day" && (
          <>
            {tasks === null && (
              <div style={{ padding: "0 20px" }}>
                <div className="skeleton-card" />
                <div className="skeleton-card" style={{ height: 36 }} />
              </div>
            )}
            {tasks !== null && filtered.length === 0 && (
              <div className="empty-block">
                <div className="empty-icon"><ListChecks size={40} /></div>
                <p>На цей день немає задач за обраним фільтром.</p>
              </div>
            )}
            {tasks !== null && filtered.length > 0 && (
              <div className="section-block">{filtered.map(renderTaskRow)}</div>
            )}
          </>
        )}
        {viewMode === "week" && (
          <>
            {weekTasks === null && (
              <div style={{ padding: "0 20px" }}>
                <div className="skeleton-card" />
                <div className="skeleton-card" style={{ height: 36 }} />
              </div>
            )}
            {weekTasks !== null && (
              <div className="section-block">
                {weekDays.map((d) => {
                  const dayKey = d.toDateString();
                  const dateParam = toDateParam(d);
                  const isToday = dayKey === today.toDateString();
                  const label = capitalize(
                    d.toLocaleDateString("uk-UA", { weekday: "short", day: "numeric", month: "long" })
                  );
                  const dayTasks = weekFiltered
                    .filter((t) =>
                      t.scheduled_at ? new Date(t.scheduled_at).toDateString() === dayKey : t.deadline === dateParam
                    )
                    .sort((a, b) => {
                      const aTime = a.scheduled_at ? a.scheduled_at.slice(11, 16) : "99:99";
                      const bTime = b.scheduled_at ? b.scheduled_at.slice(11, 16) : "99:99";
                      return aTime.localeCompare(bTime);
                    });
                  return (
                    <div className="week-day-group" key={dayKey}>
                      <div className={`week-day-heading${isToday ? " is-today" : ""}`}>
                        {label}{isToday ? " · сьогодні" : ""}
                      </div>
                      {dayTasks.length === 0 && <div className="week-empty">Немає задач</div>}
                      {dayTasks.map(renderTaskRow)}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
