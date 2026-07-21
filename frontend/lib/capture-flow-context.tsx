"use client";

import { createContext, ReactNode, useContext, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Task } from "@/lib/types";

export type CaptureStage =
  | "closed"
  | "choice"
  | "voice"
  | "text"
  | "processing"
  | "success"
  | "empty"
  | "error"
  | "rescheduled"
  | "not_found";

type CaptureResponse = {
  kind: "created" | "rescheduled" | "not_found";
  tasks: Task[];
  task: Task | null;
};

type CaptureFlowContextValue = {
  stage: CaptureStage;
  createdCount: number;
  rescheduledTask: Task | null;
  submitError: string | null;
  open: () => void;
  openVoice: () => void;
  openText: () => void;
  close: () => void;
  submitCapture: (rawText: string) => Promise<void>;
};

const CaptureFlowContext = createContext<CaptureFlowContextValue | undefined>(undefined);

export function CaptureFlowProvider({ children }: { children: ReactNode }) {
  const [stage, setStage] = useState<CaptureStage>("closed");
  const [createdCount, setCreatedCount] = useState(0);
  const [rescheduledTask, setRescheduledTask] = useState<Task | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  async function submitCapture(rawText: string) {
    setStage("processing");
    try {
      const result = await api.post<CaptureResponse>("/captures", { raw_text: rawText });
      if (result.kind === "rescheduled") {
        setRescheduledTask(result.task);
        setStage("rescheduled");
      } else if (result.kind === "not_found") {
        setStage("not_found");
      } else {
        setCreatedCount(result.tasks.length);
        setStage(result.tasks.length === 0 ? "empty" : "success");
      }
    } catch (err) {
      setSubmitError(
        err instanceof ApiError ? err.message : "Перевірте з'єднання з інтернетом і спробуйте ще раз"
      );
      setStage("error");
    }
  }

  return (
    <CaptureFlowContext.Provider
      value={{
        stage,
        createdCount,
        rescheduledTask,
        submitError,
        open: () => setStage("choice"),
        openVoice: () => setStage("voice"),
        openText: () => setStage("text"),
        close: () => setStage("closed"),
        submitCapture,
      }}
    >
      {children}
    </CaptureFlowContext.Provider>
  );
}

export function useCaptureFlow() {
  const ctx = useContext(CaptureFlowContext);
  if (!ctx) throw new Error("useCaptureFlow must be used within CaptureFlowProvider");
  return ctx;
}
