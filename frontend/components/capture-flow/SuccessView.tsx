"use client";

import { Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCaptureFlow } from "@/lib/capture-flow-context";

function pluralizeTasks(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "задачу";
  if ([2, 3, 4].includes(mod10) && ![12, 13, 14].includes(mod100)) return "задачі";
  return "задач";
}

export function SuccessView() {
  const { createdCount, close } = useCaptureFlow();
  const router = useRouter();

  function handleReview() {
    close();
    router.push("/inbox");
  }

  return (
    <div className="success-stage">
      <div className="success-icon"><Check size={30} /></div>
      <h3 className="flow-heading" style={{ margin: 0 }}>
        Taska створив {createdCount} {pluralizeTasks(createdCount)}
      </h3>
      <p className="flow-sub" style={{ marginBottom: 8 }}>Перегляньте їх у Вхідних.</p>
      <button className="primary-btn" onClick={handleReview}>Переглянути задачі</button>
    </div>
  );
}
