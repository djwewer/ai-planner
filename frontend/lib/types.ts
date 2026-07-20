export type TaskStatus = "draft" | "confirmed" | "done" | "rejected";

export type Task = {
  id: number;
  title: string;
  priority: number;
  deadline: string | null;
  scheduled_at: string | null;
  google_event_id: string | null;
  status: TaskStatus;
  created_at: string;
  updated_at: string;
};

export type CalendarEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
};
