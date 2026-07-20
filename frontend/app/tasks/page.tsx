"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { Nav } from "@/components/nav";
import { ScheduleButton } from "@/components/schedule-button";

type Task = {
  id: number;
  title: string;
  priority: number;
  deadline: string | null;
  scheduled_at: string | null;
  status: string;
};

export default function TasksPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState(3);
  const [deadline, setDeadline] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [loading, user, router]);

  useEffect(() => {
    if (user) {
      api.get<Task[]>("/tasks").then(setTasks);
    }
  }, [user]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const task = await api.post<Task>("/tasks", {
        title,
        priority,
        deadline: deadline || null,
      });
      setTasks([task, ...tasks]);
      setTitle("");
      setDeadline("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не вдалося створити задачу");
    }
  }

  async function toggleDone(task: Task) {
    setError(null);
    try {
      const updated = await api.patch<Task>(`/tasks/${task.id}`, {
        status: task.status === "done" ? "confirmed" : "done",
      });
      setTasks(tasks.map((t) => (t.id === task.id ? updated : t)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не вдалося оновити задачу");
    }
  }

  async function handleDelete(task: Task) {
    setError(null);
    try {
      await api.delete(`/tasks/${task.id}`);
      setTasks(tasks.filter((t) => t.id !== task.id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не вдалося видалити задачу");
    }
  }

  function handleScheduled(taskId: number, scheduledAt: string) {
    setTasks(tasks.map((t) => (t.id === taskId ? { ...t, scheduled_at: scheduledAt } : t)));
  }

  if (loading || !user) return <p>Завантаження…</p>;

  return (
    <main>
      <Nav />
      <h1>Задачі</h1>
      {error && <p>{error}</p>}
      <form onSubmit={handleCreate}>
        <input
          placeholder="Назва задачі"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
        />
        <select value={priority} onChange={(e) => setPriority(Number(e.target.value))}>
          <option value={1}>P1 - Терміново</option>
          <option value={2}>P2 - Високий</option>
          <option value={3}>P3 - Середній</option>
          <option value={4}>P4 - Низький</option>
        </select>
        <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
        <button type="submit">Додати задачу</button>
      </form>
      <ul>
        {tasks.map((task) => (
          <li key={task.id}>
            <input
              type="checkbox"
              checked={task.status === "done"}
              onChange={() => toggleDone(task)}
            />
            {task.scheduled_at && (
              <span>
                {new Date(task.scheduled_at).toLocaleTimeString("uk-UA", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
                {" — "}
              </span>
            )}
            <span>{task.title}</span>
            <span> P{task.priority}</span>
            {task.deadline && <span> термін: {task.deadline}</span>}
            {!task.scheduled_at && (
              <ScheduleButton
                taskId={task.id}
                onScheduled={(scheduledAt) => handleScheduled(task.id, scheduledAt)}
              />
            )}
            <button onClick={() => handleDelete(task)}>Видалити</button>
          </li>
        ))}
      </ul>
    </main>
  );
}
