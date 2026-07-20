"use client";

import { useEffect, useState } from "react";
import { X, Inbox as InboxIcon } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { Task } from "@/lib/types";
import { useEditTask } from "@/lib/edit-task-context";
import { useSnackbar } from "@/lib/snackbar-context";
import { pluralizeTasks } from "@/components/capture-flow/SuccessView";

function formatTaskMeta(task: Task): { text: string; neutral: boolean } {
  if (task.scheduled_at) {
    const d = new Date(task.scheduled_at);
    const date = d.toLocaleDateString("uk-UA", { day: "numeric", month: "long" });
    const time = d.toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" });
    return { text: `${date}, ${time}`, neutral: false };
  }
  if (task.deadline) {
    const d = new Date(task.deadline);
    return { text: d.toLocaleDateString("uk-UA", { day: "numeric", month: "long" }), neutral: false };
  }
  return { text: "Без дати", neutral: true };
}

export default function InboxPage() {
  const [drafts, setDrafts] = useState<Task[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const editTask = useEditTask();
  const snackbar = useSnackbar();

  useEffect(() => {
    api.get<Task[]>("/tasks?status=draft").then(setDrafts).catch(() => setError("Не вдалося завантажити вхідні"));
  }, []);

  async function handleConfirm(task: Task) {
    setError(null);
    try {
      const updated = await api.patch<Task>(`/tasks/${task.id}`, { status: "confirmed" });
      setDrafts((current) => (current ?? []).filter((d) => d.id !== task.id));
      const meta = formatTaskMeta(updated);
      snackbar.show(meta.neutral ? "Задачу додано до списку без дати." : "Задачу додано до вашого плану.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не вдалося підтвердити задачу");
    }
  }

  async function handleReject(task: Task) {
    setError(null);
    try {
      await api.patch<Task>(`/tasks/${task.id}`, { status: "rejected" });
      setDrafts((current) => (current ?? []).filter((d) => d.id !== task.id));
      snackbar.show("Задачу відхилено.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не вдалося відхилити задачу");
    }
  }

  function handleEdit(task: Task) {
    editTask.open(task, (updated) => {
      setDrafts((current) => (current ?? []).map((d) => (d.id === updated.id ? updated : d)));
    });
  }

  const count = drafts?.length ?? 0;

  return (
    <>
      <div className="screen-header">
        <div>
          <h2>Вхідні</h2>
          <div className="date-label">
            {drafts !== null && count > 0 ? `${count} ${pluralizeTasks(count, ["задача", "задачі", "задач"])} очікують підтвердження` : ""}
          </div>
        </div>
      </div>
      {drafts !== null && count > 0 && (
        <div className="inbox-intro">Ці задачі створив Taska. Перевірте й підтвердьте їх, перш ніж вони з&apos;являться у вашому плані.</div>
      )}
      {error && <p style={{ padding: "0 20px", color: "var(--error)", fontSize: 13 }}>{error}</p>}
      <div className="scroll">
        {drafts === null && (
          <div style={{ padding: "0 20px" }}>
            <div className="skeleton-card" />
            <div className="skeleton-card" style={{ height: 36 }} />
          </div>
        )}
        {drafts !== null && count === 0 && (
          <div className="empty-block">
            <div className="empty-icon"><InboxIcon size={40} /></div>
            <p>Усе переглянуто. Нові задачі, створені Taska, з&apos;являться тут.</p>
          </div>
        )}
        {drafts?.map((task) => {
          const meta = formatTaskMeta(task);
          return (
            <div className="draft-card" key={task.id}>
              <div className="draft-badge">Очікує підтвердження</div>
              <div className="draft-title">{task.title}</div>
              <div className={`draft-meta${meta.neutral ? " neutral" : ""}`}>{meta.text}</div>
              <div className="draft-actions">
                <button className="icon-btn" aria-label="Відхилити задачу" onClick={() => handleReject(task)}>
                  <X />
                </button>
                <button className="secondary-btn" onClick={() => handleEdit(task)}>Редагувати</button>
                <button className="primary-btn" onClick={() => handleConfirm(task)}>Підтвердити</button>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
