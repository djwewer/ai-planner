"use client";

import { createContext, ReactNode, useContext, useState } from "react";
import { Task } from "@/lib/types";

type EditState = { task: Task; onSaved: (updated: Task) => void; onDeleted?: (taskId: number) => void } | null;

type EditTaskContextValue = {
  state: EditState;
  open: (task: Task, onSaved: (updated: Task) => void, onDeleted?: (taskId: number) => void) => void;
  close: () => void;
};

const EditTaskContext = createContext<EditTaskContextValue | undefined>(undefined);

export function EditTaskProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<EditState>(null);
  return (
    <EditTaskContext.Provider
      value={{
        state,
        open: (task, onSaved, onDeleted) => setState({ task, onSaved, onDeleted }),
        close: () => setState(null),
      }}
    >
      {children}
    </EditTaskContext.Provider>
  );
}

export function useEditTask() {
  const ctx = useContext(EditTaskContext);
  if (!ctx) throw new Error("useEditTask must be used within EditTaskProvider");
  return ctx;
}
