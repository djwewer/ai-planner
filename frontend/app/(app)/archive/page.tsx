"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Archive as ArchiveIcon, ArrowLeft, Check } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { Task } from "@/lib/types";
import { toDateParam } from "@/lib/date";

function groupByDay(tasks: Task[]): { label: string; tasks: Task[] }[] {
  const today = toDateParam(new Date());
  const yesterday = toDateParam(new Date(Date.now() - 86400000));
  const groups = new Map<string, Task[]>();
  for (const task of tasks) {
    const key = toDateParam(new Date(task.updated_at));
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(task);
  }
  return Array.from(groups.entries())
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([key, items]) => {
      const [year, month, day] = key.split("-").map(Number);
      const dateObj = new Date(year, month - 1, day);
      return {
        label:
          key === today
            ? "Сьогодні"
            : key === yesterday
            ? "Учора"
            : dateObj.toLocaleDateString("uk-UA", { day: "numeric", month: "long" }),
        tasks: items,
      };
    });
}

export default function ArchivePage() {
  const router = useRouter();
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<Task[]>("/tasks?status=done").then(setTasks);
  }, []);

  async function handleUndo(task: Task) {
    setError(null);
    try {
      const updated = await api.patch<Task>(`/tasks/${task.id}`, { status: "confirmed" });
      setTasks((current) => (current ?? []).filter((t) => t.id !== updated.id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не вдалося повернути задачу");
    }
  }

  const groups = tasks ? groupByDay(tasks) : [];

  return (
    <>
      <div className="screen-header">
        <button className="icon-btn" aria-label="Назад до налаштувань" onClick={() => router.push("/settings")}>
          <ArrowLeft />
        </button>
        <div>
          <h2>Архів</h2>
          <div className="date-label">Виконані задачі</div>
        </div>
        <span style={{ width: 44 }} aria-hidden="true" />
      </div>
      {error && <p style={{ padding: "0 20px", color: "var(--error)", fontSize: 13 }}>{error}</p>}
      <div className="scroll">
        {tasks === null && (
          <div style={{ padding: "0 20px" }}>
            <div className="skeleton-card" />
            <div className="skeleton-card" style={{ height: 36 }} />
          </div>
        )}
        {tasks !== null && tasks.length === 0 && (
          <div className="empty-block">
            <div className="empty-icon"><ArchiveIcon size={40} /></div>
            <p>Тут з&apos;являться задачі, які ви позначите виконаними.</p>
          </div>
        )}
        {groups.map((group) => (
          <div className="section-block" key={group.label}>
            <div className="section-title">{group.label}</div>
            {group.tasks.map((task) => (
              <div className="flat-row" key={task.id}>
                <button className="checkbox done" aria-label="Позначити невиконаним" onClick={() => handleUndo(task)}>
                  <Check size={12} />
                </button>
                <div className="flat-title archived">{task.title}</div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}
