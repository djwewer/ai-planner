"use client";

import { ReactNode, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";
import { Task } from "@/lib/types";
import { BottomNav } from "@/components/bottom-nav/BottomNav";
import { SnackbarProvider } from "@/lib/snackbar-context";
import { CaptureFlowProvider } from "@/lib/capture-flow-context";
import { CaptureFlow } from "@/components/capture-flow/CaptureFlow";
import { EditTaskProvider } from "@/lib/edit-task-context";
import { EditTaskSheet } from "@/components/edit-task-sheet/EditTaskSheet";

export default function AppLayout({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [inboxCount, setInboxCount] = useState(0);

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [loading, user, router]);

  useEffect(() => {
    if (!user) return;
    api.get<Task[]>("/tasks?status=draft").then((tasks) => setInboxCount(tasks.length));
  }, [user, pathname]);

  if (loading || !user) return <p>Завантаження…</p>;

  return (
    <SnackbarProvider>
      <CaptureFlowProvider>
        <EditTaskProvider>
          <div className="app-shell">
            <div className="screen">{children}</div>
            <BottomNav inboxCount={inboxCount} />
            <CaptureFlow />
            <EditTaskSheet />
          </div>
        </EditTaskProvider>
      </CaptureFlowProvider>
    </SnackbarProvider>
  );
}
