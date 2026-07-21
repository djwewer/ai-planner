"use client";

import { AlertTriangle } from "lucide-react";
import { useCaptureFlow } from "@/lib/capture-flow-context";

export function NotFoundView() {
  const { close, open } = useCaptureFlow();

  function handleRetry() {
    close();
    open();
  }

  return (
    <div className="success-stage">
      <div className="empty-block">
        <div className="empty-icon warn"><AlertTriangle /></div>
        <p>Taska не знайшла задачу, яку потрібно перенести. Спробуйте сформулювати інакше.</p>
      </div>
      <button className="secondary-btn" onClick={handleRetry}>Спробувати ще раз</button>
    </div>
  );
}
