"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Task } from "@/lib/types";
import { useEditTask } from "@/lib/edit-task-context";

const fieldLabelStyle: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: "var(--text-secondary)" };
const fieldInputStyle: React.CSSProperties = {
  width: "100%",
  marginTop: 6,
  padding: 12,
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-sm)",
  fontSize: 15,
  fontFamily: "var(--font-ui)",
};

export function EditTaskSheet() {
  const { state, close } = useEditTask();

  if (!state) return null;
  return <EditTaskSheetForm key={state.task.id} task={state.task} onSaved={state.onSaved} onClose={close} />;
}

function EditTaskSheetForm({
  task,
  onSaved,
  onClose,
}: {
  task: Task;
  onSaved: (updated: Task) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(task.title);
  const [date, setDate] = useState(task.deadline ?? task.scheduled_at?.slice(0, 10) ?? "");
  const [time, setTime] = useState(task.scheduled_at ? task.scheduled_at.slice(11, 16) : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setError(null);
    setSaving(true);
    try {
      const updated = await api.patch<Task>(`/tasks/${task.id}`, {
        title,
        deadline: date || null,
        scheduled_at: date && time ? `${date}T${time}:00` : null,
      });
      onSaved(updated);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не вдалося зберегти задачу");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flow">
      <div className="flow-header">
        <button className="text-btn" onClick={onClose}>Скасувати</button>
        <div className="flow-title">Редагувати задачу</div>
        <button className="text-btn" onClick={handleSave} disabled={saving}>Зберегти</button>
      </div>
      <div className="flow-body" style={{ gap: 16 }}>
        {error && <p style={{ color: "var(--error)", fontSize: 13 }}>{error}</p>}
        <label style={fieldLabelStyle}>
          Назва
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} style={fieldInputStyle} />
        </label>
        <label style={fieldLabelStyle}>
          Дата
          <input
            type="date"
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              if (!e.target.value) setTime("");
            }}
            style={fieldInputStyle}
          />
        </label>
        <label style={fieldLabelStyle}>
          Час
          <input type="time" value={time} disabled={!date} onChange={(e) => setTime(e.target.value)} style={fieldInputStyle} />
        </label>
      </div>
    </div>
  );
}
