"use client";

import { WifiOff } from "lucide-react";
import { useCaptureFlow } from "@/lib/capture-flow-context";

export function ErrorResultView() {
  const { close, open, submitError } = useCaptureFlow();

  function handleRetry() {
    close();
    open();
  }

  return (
    <div className="success-stage">
      <div className="empty-block">
        <div className="empty-icon err"><WifiOff /></div>
        <p>{submitError ?? "Перевірте з'єднання з інтернетом і спробуйте ще раз."}</p>
      </div>
      <button className="secondary-btn" onClick={handleRetry}>Спробувати ще раз</button>
    </div>
  );
}
