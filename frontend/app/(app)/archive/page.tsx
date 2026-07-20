"use client";

import { useEffect, useState } from "react";
import { Archive as ArchiveIcon, Check } from "lucide-react";
import { api } from "@/lib/api";
import { Task } from "@/lib/types";

function groupByDay(tasks: Task[]): { label: string; tasks: Task[] }[] {
  const today = new Date().toDateString();
  const yesterday = new Date(Date.now() - 86400000).toDateString();
  const groups = new Map<string, Task[]>();
  for (const task of tasks) {
    const key = new Date(task.updated_at).toDateString();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(task);
  }
  return Array.from(groups.entries())
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([key, items]) => ({
      label:
        key === today
          ? "Сьогодні"
          : key === yesterday
          ? "Учора"
          : new Date(key).toLocaleDateString("uk-UA", { day: "numeric", month: "long" }),
      tasks: items,
    }));
}

export default function ArchivePage() {
  const [tasks, setTasks] = useState<Task[] | null>(null);

  useEffect(() => {
    api.get<Task[]>("/tasks?status=done").then(setTasks);
  }, []);

  async function handleUndo(task: Task) {
    const updated = await api.patch<Task>(`/tasks/${task.id}`, { status: "confirmed" });
    setTasks((current) => (current ?? []).filter((t) => t.id !== updated.id));
  }

  const groups = tasks ? groupByDay(tasks) : [];

  return (
    <>
      <div className="screen-header">
        <div>
          <h2>Архів</h2>
          <div className="date-label">Виконані задачі</div>
        </div>
      </div>
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
