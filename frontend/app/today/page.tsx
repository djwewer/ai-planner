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
  status: string;
};

export default function TodayPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [loading, user, router]);

  useEffect(() => {
    if (user) {
      api.get<Task[]>("/tasks/today").then(setTasks);
    }
  }, [user]);

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

  if (loading || !user) return <p>Завантаження…</p>;

  return (
    <main>
      <Nav />
      <h1>Сьогодні</h1>
      {error && <p>{error}</p>}
      {tasks.length === 0 && <p>На сьогодні задач немає.</p>}
      <ul>
        {tasks.map((task) => (
          <li key={task.id}>
            <input
              type="checkbox"
              checked={task.status === "done"}
              onChange={() => toggleDone(task)}
            />
            <span>{task.title}</span>
            <span> P{task.priority}</span>
            {task.deadline && <span> термін: {task.deadline}</span>}
          </li>
        ))}
      </ul>
    </main>
  );
}
