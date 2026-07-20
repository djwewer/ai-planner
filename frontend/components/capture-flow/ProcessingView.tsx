"use client";

import { useEffect, useState } from "react";

const STEPS = ["Запис отримано", "Визначаємо задачі", "Готуємо задачі для перегляду"];

export function ProcessingView() {
  const [activeStep, setActiveStep] = useState(0);

  useEffect(() => {
    const t1 = setTimeout(() => setActiveStep(1), 700);
    const t2 = setTimeout(() => setActiveStep(2), 1400);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);

  return (
    <div className="process-stage">
      <div className="spinner" />
      <div className="process-steps">
        {STEPS.map((label, i) => (
          <div key={label} className={`process-step${i === activeStep ? " active" : ""}${i < activeStep ? " done" : ""}`}>
            <span className="dot" />
            {label}
          </div>
        ))}
      </div>
    </div>
  );
}
