"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

type Task = {
  id: number;
  title: string;
  priority: number;
  deadline: string | null;
  status: string;
};

export default function TasksPage() {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState(3);
  const [deadline, setDeadline] = useState("");

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
    const task = await api.post<Task>("/tasks", {
      title,
      priority,
      deadline: deadline || null,
    });
    setTasks([task, ...tasks]);
    setTitle("");
    setDeadline("");
  }

  async function toggleDone(task: Task) {
    const updated = await api.patch<Task>(`/tasks/${task.id}`, {
      status: task.status === "done" ? "confirmed" : "done",
    });
    setTasks(tasks.map((t) => (t.id === task.id ? updated : t)));
  }

  async function handleDelete(task: Task) {
    await api.delete(`/tasks/${task.id}`);
    setTasks(tasks.filter((t) => t.id !== task.id));
  }

  if (loading || !user) return <p>Loading…</p>;

  return (
    <main>
      <h1>Tasks</h1>
      <button onClick={logout}>Log out</button>
      <form onSubmit={handleCreate}>
        <input
          placeholder="Task title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
        />
        <select value={priority} onChange={(e) => setPriority(Number(e.target.value))}>
          <option value={1}>P1 - Urgent</option>
          <option value={2}>P2 - High</option>
          <option value={3}>P3 - Medium</option>
          <option value={4}>P4 - Low</option>
        </select>
        <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
        <button type="submit">Add task</button>
      </form>
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
            {task.deadline && <span> due {task.deadline}</span>}
            <button onClick={() => handleDelete(task)}>Delete</button>
          </li>
        ))}
      </ul>
    </main>
  );
}
