"use client";

import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { useCaptureFlow } from "@/lib/capture-flow-context";

export function TextFlow() {
  const { close, submitCapture } = useCaptureFlow();
  const [text, setText] = useState("");

  function handleSubmit() {
    const value = text.trim();
    if (!value) return;
    submitCapture(value);
    setText("");
  }

  return (
    <div className="flow">
      <div className="flow-header">
        <button className="icon-btn" aria-label="Назад" onClick={close}><ArrowLeft /></button>
      </div>
      <div className="flow-body" style={{ paddingTop: 4 }}>
        <h3 className="flow-heading" style={{ marginTop: 0, textAlign: "left" }}>Що потрібно зробити?</h3>
        <textarea
          className="capture-textarea"
          placeholder="Наприклад: подзвонити Андрію завтра о 14:00 і підготувати звіт до п'ятниці"
          value={text}
          onChange={(e) => setText(e.target.value)}
          autoFocus
        />
        <button className="primary-btn" style={{ marginTop: 16 }} disabled={text.trim().length === 0} onClick={handleSubmit}>
          Надіслати
        </button>
      </div>
    </div>
  );
}
