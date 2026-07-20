"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";

type ScheduleButtonProps = {
  taskId: number;
  onScheduled: (scheduledAt: string) => void;
};

export function ScheduleButton({ taskId, onScheduled }: ScheduleButtonProps) {
  const [loading, setLoading] = useState(false);
  const [slots, setSlots] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setError(null);
    setLoading(true);
    try {
      const { slots: fetchedSlots } = await api.get<{ slots: string[] }>(
        `/tasks/${taskId}/schedule-suggestions`
      );
      if (fetchedSlots.length === 0) {
        setError("Немає вільних слотів на цей день");
      } else {
        setSlots(fetchedSlots);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не вдалося отримати пропозиції");
    } finally {
      setLoading(false);
    }
  }

  async function handlePick(slot: string) {
    setError(null);
    try {
      await api.patch(`/tasks/${taskId}`, { scheduled_at: slot });
      onScheduled(slot);
      setSlots(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не вдалося запланувати задачу");
    }
  }

  if (slots) {
    return (
      <span>
        {slots.map((slot) => (
          <button key={slot} onClick={() => handlePick(slot)}>
            {new Date(slot).toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" })}
          </button>
        ))}
        {error && <span> {error}</span>}
      </span>
    );
  }

  return (
    <span>
      <button onClick={handleClick} disabled={loading}>
        {loading ? "…" : "Запланувати"}
      </button>
      {error && <span> {error}</span>}
    </span>
  );
}
