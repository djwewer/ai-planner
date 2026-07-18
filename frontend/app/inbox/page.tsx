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

export default function InboxPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [drafts, setDrafts] = useState<Task[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [loading, user, router]);

  useEffect(() => {
    if (user) {
      api.get<Task[]>("/tasks?status=draft").then(setDrafts);
    }
  }, [user]);

  function updateDraftField(id: number, field: keyof Task, value: string | number) {
    setDrafts(drafts.map((d) => (d.id === id ? { ...d, [field]: value } : d)));
  }

  async function handleApprove(task: Task) {
    setError(null);
    try {
      await api.patch<Task>(`/tasks/${task.id}`, {
        title: task.title,
        priority: task.priority,
        deadline: task.deadline || null,
        status: "confirmed",
      });
      setDrafts(drafts.filter((d) => d.id !== task.id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не вдалося підтвердити задачу");
    }
  }

  async function handleReject(task: Task) {
    setError(null);
    try {
      await api.patch<Task>(`/tasks/${task.id}`, { status: "rejected" });
      setDrafts(drafts.filter((d) => d.id !== task.id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не вдалося відхилити задачу");
    }
  }

  if (loading || !user) return <p>Завантаження…</p>;

  return (
    <main>
      <Nav />
      <h1>Вхідні</h1>
      {error && <p>{error}</p>}
      {drafts.length === 0 && <p>Немає задач на розгляді.</p>}
      <ul>
        {drafts.map((task) => (
          <li key={task.id}>
            <input
              value={task.title}
              onChange={(e) => updateDraftField(task.id, "title", e.target.value)}
            />
            <select
              value={task.priority}
              onChange={(e) => updateDraftField(task.id, "priority", Number(e.target.value))}
            >
              <option value={1}>P1 - Терміново</option>
              <option value={2}>P2 - Високий</option>
              <option value={3}>P3 - Середній</option>
              <option value={4}>P4 - Низький</option>
            </select>
            <input
              type="date"
              value={task.deadline ?? ""}
              onChange={(e) => updateDraftField(task.id, "deadline", e.target.value)}
            />
            <button onClick={() => handleApprove(task)}>Підтвердити</button>
            <button onClick={() => handleReject(task)}>Відхилити</button>
          </li>
        ))}
      </ul>
    </main>
  );
}
