"use client";

import { CalendarCheck2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCaptureFlow } from "@/lib/capture-flow-context";

function formatTaskWhen(task: { scheduled_at: string | null; deadline: string | null }): string {
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
  return "";
}

export function RescheduledView() {
  const { rescheduledTask, close } = useCaptureFlow();
  const router = useRouter();

  function handleReview() {
    close();
    router.push("/calendar");
  }

  if (!rescheduledTask) return null;

  return (
    <div className="success-stage">
      <div className="success-icon"><CalendarCheck2 size={30} /></div>
      <h3 className="flow-heading" style={{ margin: 0 }}>Перенесено</h3>
      <p className="flow-sub" style={{ marginBottom: 8 }}>
        «{rescheduledTask.title}» тепер {formatTaskWhen(rescheduledTask)}
      </p>
      <button className="primary-btn" onClick={handleReview}>Переглянути задачі</button>
    </div>
  );
}
