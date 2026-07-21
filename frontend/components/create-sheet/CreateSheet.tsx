"use client";

import { Mic, Type } from "lucide-react";
import { useCaptureFlow } from "@/lib/capture-flow-context";

export function CreateSheet() {
  const { openVoice, openText } = useCaptureFlow();

  return (
    <>
      <div className="drag-handle" />
      <h3>Створити нове</h3>
      <button className="sheet-row" onClick={openVoice}>
        <div className="sheet-row-icon"><Mic /></div>
        <div>
          <div className="sheet-row-title">Записати голосом</div>
          <div className="sheet-row-sub">Скажіть Tenoa, що потрібно зробити, своїми словами.</div>
        </div>
      </button>
      <button className="sheet-row" onClick={openText}>
        <div className="sheet-row-icon"><Type /></div>
        <div>
          <div className="sheet-row-title">Ввести текст</div>
          <div className="sheet-row-sub">Напишіть одну або кілька задач в одному повідомленні.</div>
        </div>
      </button>
    </>
  );
}
