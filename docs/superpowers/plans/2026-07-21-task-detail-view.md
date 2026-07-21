# Task Detail View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user tap any confirmed task (in the Tasks list or anywhere in Calendar) to open a detail/edit sheet showing its priority, date, and time, with actions to edit, mark done, or delete.

**Architecture:** Extend the existing global `EditTaskSheet` (already mounted app-wide via `EditTaskProvider`/`useEditTask()`, currently used only by Inbox's draft-review flow) with a priority pill plus mark-done and delete actions, gated to only show for confirmed tasks (Inbox's draft tasks keep their current unchanged behavior). Then wire a tap handler into every place a task row is rendered — the Tasks list, the Calendar Day tab's timeline and flat-row lists, and the Week/Month tabs' shared row component — to open that same sheet. No backend changes: everything uses the existing `PATCH /tasks/{id}` and `DELETE /tasks/{id}` endpoints already in use elsewhere.

**Tech Stack:** Next.js 16 / React 19 / TypeScript, existing `frontend/lib/edit-task-context.tsx` global context, existing CSS classes (`.priority-pill`, `.icon-btn.danger`, `.secondary-btn`, `.flow`).

## Global Constraints

- No new backend endpoints or Task fields. Reuse `PATCH /tasks/{id}` (`title`, `deadline`, `scheduled_at`, `status`) and `DELETE /tasks/{id}` exactly as already called elsewhere in the frontend.
- All new UI text in Ukrainian, matching existing copy style in the touched files.
- The sheet's mark-done and delete actions must render only when `task.status === "confirmed"` — Inbox's existing draft-review usage of the same sheet must keep behaving exactly as it does today (no delete/mark-done buttons appear there).
- Every tap-to-open wire-up must `stopPropagation` on nested interactive controls (checkboxes, delete buttons) so tapping them does not also open the detail sheet.
- On the Calendar Day tab's timeline, a quick tap (no hold, no drag) opens the detail sheet; the existing press-and-hold-then-move drag-to-reschedule gesture (Plan D) must be unaffected.
- This repo has no frontend automated test runner (`package.json` only defines `build`/`lint`/`dev`/`start`). Every task's verification is `npm run build && npm run lint` plus a manual browser walkthrough — matching how prior frontend-only plans in this repo were verified.

---

### Task 1: Shared priority labels + detail actions in EditTaskSheet

**Files:**
- Create: `frontend/lib/priority.ts`
- Modify: `frontend/lib/edit-task-context.tsx`
- Modify: `frontend/components/edit-task-sheet/EditTaskSheet.tsx`
- Modify: `frontend/app/(app)/tasks/page.tsx` (swap its local `PRIORITY_LABELS` for the shared one — import only, no behavior change)

**Interfaces:**
- Consumes: existing `Task` type (`frontend/lib/types.ts`), existing `api.patch`/`api.delete` (`frontend/lib/api.ts`).
- Produces: `PRIORITY_LABELS: Record<number, string>` exported from `frontend/lib/priority.ts`; `EditTaskContextValue.open(task: Task, onSaved: (updated: Task) => void, onDeleted?: (taskId: number) => void): void` (the updated signature, with `onDeleted` newly added as optional) — later tasks call this to remove a deleted task from their own lists.

- [ ] **Step 1: Extract shared priority labels**

Create `frontend/lib/priority.ts`:

```ts
export const PRIORITY_LABELS: Record<number, string> = {
  1: "Терміново",
  2: "Високий",
  3: "Середній",
  4: "Низький",
};
```

- [ ] **Step 2: Point the Tasks list at the shared constant**

In `frontend/app/(app)/tasks/page.tsx`, find:

```tsx
const PRIORITY_LABELS: Record<number, string> = {
  1: "Терміново",
  2: "Високий",
  3: "Середній",
  4: "Низький",
};
```

Delete it, and add this import alongside the existing ones at the top of the file:

```tsx
import { PRIORITY_LABELS } from "@/lib/priority";
```

- [ ] **Step 3: Add an optional `onDeleted` to the edit-task context**

Replace the full contents of `frontend/lib/edit-task-context.tsx` with:

```tsx
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
```

(This is backward-compatible: `frontend/app/(app)/inbox/page.tsx`'s existing `editTask.open(task, onSaved)` two-argument call keeps working unchanged, since `onDeleted` is optional.)

- [ ] **Step 4: Add priority pill, mark-done, and delete to the sheet**

Replace the full contents of `frontend/components/edit-task-sheet/EditTaskSheet.tsx` with:

```tsx
"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { Task } from "@/lib/types";
import { PRIORITY_LABELS } from "@/lib/priority";
import { useEditTask } from "@/lib/edit-task-context";

const fieldLabelStyle: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: "var(--text-secondary)" };
const fieldInputStyle: React.CSSProperties = {
  width: "100%",
  marginTop: 6,
  padding: 12,
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-sm)",
  fontSize: 15,
  fontFamily: "var(--font-ui)",
};

export function EditTaskSheet() {
  const { state, close } = useEditTask();

  if (!state) return null;
  return (
    <EditTaskSheetForm
      key={state.task.id}
      task={state.task}
      onSaved={state.onSaved}
      onDeleted={state.onDeleted}
      onClose={close}
    />
  );
}

function EditTaskSheetForm({
  task,
  onSaved,
  onDeleted,
  onClose,
}: {
  task: Task;
  onSaved: (updated: Task) => void;
  onDeleted?: (taskId: number) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(task.title);
  const [date, setDate] = useState(task.deadline ?? task.scheduled_at?.slice(0, 10) ?? "");
  const [time, setTime] = useState(task.scheduled_at ? task.scheduled_at.slice(11, 16) : "");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const showTaskActions = task.status === "confirmed";

  async function handleSave() {
    setError(null);
    setSaving(true);
    try {
      const updated = await api.patch<Task>(`/tasks/${task.id}`, {
        title,
        deadline: date || null,
        scheduled_at: date && time ? `${date}T${time}:00` : null,
      });
      onSaved(updated);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не вдалося зберегти задачу");
    } finally {
      setSaving(false);
    }
  }

  async function handleMarkDone() {
    setError(null);
    try {
      const updated = await api.patch<Task>(`/tasks/${task.id}`, { status: "done" });
      onSaved(updated);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не вдалося позначити задачу виконаною");
    }
  }

  async function handleDelete() {
    setError(null);
    setDeleting(true);
    try {
      await api.delete(`/tasks/${task.id}`);
      onDeleted?.(task.id);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не вдалося видалити задачу");
      setDeleting(false);
    }
  }

  return (
    <div className="flow">
      <div className="flow-header">
        <button className="text-btn" onClick={onClose}>Скасувати</button>
        <div className="flow-title">Редагувати задачу</div>
        <button className="text-btn" onClick={handleSave} disabled={saving}>Зберегти</button>
      </div>
      <div className="flow-body" style={{ gap: 16 }}>
        {error && <p style={{ color: "var(--error)", fontSize: 13 }}>{error}</p>}
        <span className={`priority-pill p${task.priority}`} style={{ alignSelf: "flex-start" }}>
          {PRIORITY_LABELS[task.priority]}
        </span>
        <label style={fieldLabelStyle}>
          Назва
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} style={fieldInputStyle} />
        </label>
        <label style={fieldLabelStyle}>
          Дата
          <input
            type="date"
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              if (!e.target.value) setTime("");
            }}
            style={fieldInputStyle}
          />
        </label>
        <label style={fieldLabelStyle}>
          Час
          <input type="time" value={time} disabled={!date} onChange={(e) => setTime(e.target.value)} style={fieldInputStyle} />
        </label>
        {showTaskActions && (
          <div style={{ display: "flex", gap: 10, marginTop: "auto" }}>
            <button className="secondary-btn" style={{ flex: 1 }} onClick={handleMarkDone}>
              Позначити виконаним
            </button>
            <button
              className="icon-btn danger"
              aria-label="Видалити задачу"
              disabled={deleting}
              onClick={handleDelete}
            >
              <Trash2 size={18} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Verify — build and lint**

```bash
cd frontend && npm run build && npm run lint
```

Expected: both clean, no errors.

- [ ] **Step 6: Verify in the browser**

Start the dev server and a test backend. In Inbox, tap a draft task's edit action — confirm the sheet still opens with only title/date/time fields and no mark-done/delete buttons (draft tasks are not `confirmed`). This task's own new UI has no trigger yet (that's Tasks 2–4) — this step only confirms Inbox is unaffected.

- [ ] **Step 7: Commit**

```bash
git add frontend/lib/priority.ts frontend/lib/edit-task-context.tsx frontend/components/edit-task-sheet/EditTaskSheet.tsx "frontend/app/(app)/tasks/page.tsx"
git commit -m "feat(frontend): add priority, mark-done, and delete to the task detail sheet"
```

---

### Task 2: Tasks list — tap a row to open the detail sheet

**Files:**
- Modify: `frontend/app/(app)/tasks/page.tsx`
- Modify: `frontend/app/globals.css` (add `cursor: pointer` to `.task-row`)

**Interfaces:**
- Consumes: `EditTaskContextValue.open(task, onSaved, onDeleted?)` (Task 1, Step 3); `PRIORITY_LABELS` (Task 1, Step 1, already wired in Task 1 Step 2).
- Produces: nothing consumed by later tasks — this task is self-contained to the Tasks list page.

- [ ] **Step 1: Wire up the context and an open-detail handler**

In `frontend/app/(app)/tasks/page.tsx`, add this import alongside the existing ones:

```tsx
import { useEditTask } from "@/lib/edit-task-context";
```

Inside `TasksPage`, alongside the existing `useState` calls, add:

```tsx
  const editTask = useEditTask();
```

Add this function alongside `handleDelete`/`handleMarkDone`:

```tsx
  function handleOpenDetail(task: Task) {
    editTask.open(
      task,
      (updated) => {
        setTasks((current) =>
          (current ?? [])
            .map((t) => (t.id === updated.id ? updated : t))
            .filter((t) => t.status === "confirmed")
        );
      },
      (deletedId) => {
        setTasks((current) => (current ?? []).filter((t) => t.id !== deletedId));
      }
    );
  }
```

- [ ] **Step 2: Make the row tappable, keep inner controls isolated**

Find the row rendering block:

```tsx
              <div className="task-row" key={task.id}>
                <button
                  className="checkbox"
                  aria-label="Позначити виконаним"
                  onClick={() => handleMarkDone(task)}
                >
                  <Check size={12} />
                </button>
                <div className="task-row-main">
                  <div className="task-row-title">{task.title}</div>
                  <div className="task-row-meta">
                    <span className={`priority-pill p${task.priority}`}>{PRIORITY_LABELS[task.priority]}</span>
                    <span className="task-row-when">{formatTaskWhen(task)}</span>
                  </div>
                </div>
                {pendingDeleteId === task.id ? (
                  <div className="task-row-confirm">
                    <button className="text-btn" onClick={() => setPendingDeleteId(null)}>Скасувати</button>
                    <button
                      className="icon-btn danger"
                      aria-label="Підтвердити видалення"
                      onClick={() => handleDelete(task)}
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                ) : (
                  <button
                    className="icon-btn danger"
                    aria-label="Видалити задачу"
                    onClick={() => setPendingDeleteId(task.id)}
                  >
                    <Trash2 size={18} />
                  </button>
                )}
              </div>
```

Replace it with:

```tsx
              <div className="task-row" key={task.id} onClick={() => handleOpenDetail(task)}>
                <button
                  className="checkbox"
                  aria-label="Позначити виконаним"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleMarkDone(task);
                  }}
                >
                  <Check size={12} />
                </button>
                <div className="task-row-main">
                  <div className="task-row-title">{task.title}</div>
                  <div className="task-row-meta">
                    <span className={`priority-pill p${task.priority}`}>{PRIORITY_LABELS[task.priority]}</span>
                    <span className="task-row-when">{formatTaskWhen(task)}</span>
                  </div>
                </div>
                {pendingDeleteId === task.id ? (
                  <div className="task-row-confirm" onClick={(e) => e.stopPropagation()}>
                    <button className="text-btn" onClick={() => setPendingDeleteId(null)}>Скасувати</button>
                    <button
                      className="icon-btn danger"
                      aria-label="Підтвердити видалення"
                      onClick={() => handleDelete(task)}
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                ) : (
                  <button
                    className="icon-btn danger"
                    aria-label="Видалити задачу"
                    onClick={(e) => {
                      e.stopPropagation();
                      setPendingDeleteId(task.id);
                    }}
                  >
                    <Trash2 size={18} />
                  </button>
                )}
              </div>
```

- [ ] **Step 3: Add a pointer cursor affordance**

In `frontend/app/globals.css`, find:

```css
.task-row { display: flex; align-items: center; gap: 10px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 12px 14px; margin-bottom: 10px; }
```

Replace it with:

```css
.task-row { display: flex; align-items: center; gap: 10px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 12px 14px; margin-bottom: 10px; cursor: pointer; }
```

- [ ] **Step 4: Verify — build and lint**

```bash
cd frontend && npm run build && npm run lint
```

Expected: both clean, no errors.

- [ ] **Step 5: Verify in the browser**

On the Tasks tab: tap a row's title/meta area — the detail sheet opens with the correct priority pill, title, date, and time. Tap the checkbox directly — it marks the task done and the sheet does NOT open. Tap the delete icon directly — it arms the two-step delete confirm and the sheet does NOT open. Inside the open sheet, tap "Позначити виконаним" — the task disappears from the list and the sheet closes. Reopen another task and tap the delete icon inside the sheet — the task disappears from the list and the sheet closes.

- [ ] **Step 6: Commit**

```bash
git add "frontend/app/(app)/tasks/page.tsx" frontend/app/globals.css
git commit -m "feat(frontend): tap a task row to open its detail sheet"
```

---

### Task 3: Calendar Day tab — tap opens detail, hold-and-move still drags

**Files:**
- Modify: `frontend/components/timeline/Timeline.tsx`
- Modify: `frontend/app/(app)/calendar/page.tsx`

**Interfaces:**
- Consumes: `EditTaskContextValue.open(task, onSaved, onDeleted?)` (Task 1, Step 3).
- Produces: `Timeline`'s new `onOpenDetail: (taskId: number) => void` prop; `handleOpenDetail(task: Task): void` defined in `frontend/app/(app)/calendar/page.tsx` — Task 4 calls this same function for the Week/Month tabs.

- [ ] **Step 1: Track which task a gesture started on, and detect a plain tap**

In `frontend/components/timeline/Timeline.tsx`, find the component signature:

```tsx
export function Timeline({
  items,
  onToggle,
  onReschedule,
  isToday,
}: {
  items: TimelineItem[];
  onToggle: (taskId: number) => void;
  onReschedule: (taskId: number, newTop: number) => void;
  isToday: boolean;
}) {
```

Replace it with:

```tsx
export function Timeline({
  items,
  onToggle,
  onReschedule,
  onOpenDetail,
  isToday,
}: {
  items: TimelineItem[];
  onToggle: (taskId: number) => void;
  onReschedule: (taskId: number, newTop: number) => void;
  onOpenDetail: (taskId: number) => void;
  isToday: boolean;
}) {
```

Find:

```tsx
  const pointerStartRef = useRef<{ pointerId: number; x: number; y: number; top: number } | null>(null);
```

Replace it with:

```tsx
  const pointerStartRef = useRef<{ pointerId: number; x: number; y: number; top: number; taskId: number } | null>(null);
```

Find:

```tsx
  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>, taskId: number, top: number) {
    if (pointerStartRef.current) return;
    const target = e.currentTarget;
    const pointerId = e.pointerId;
    pointerStartRef.current = { pointerId, x: e.clientX, y: e.clientY, top };
```

Replace it with:

```tsx
  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>, taskId: number, top: number) {
    if (pointerStartRef.current) return;
    const target = e.currentTarget;
    const pointerId = e.pointerId;
    pointerStartRef.current = { pointerId, x: e.clientX, y: e.clientY, top, taskId };
```

Find:

```tsx
  function endDrag(e: React.PointerEvent<HTMLDivElement>, commit: boolean) {
    if (!pointerStartRef.current || e.pointerId !== pointerStartRef.current.pointerId) return;
    const wasDragging = draggingRef.current;
    if (wasDragging) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    if (wasDragging && commit && drag && drag.currentTop !== drag.startTop) {
      onReschedule(drag.taskId, drag.currentTop);
    }
    resetDragState();
  }
```

Replace it with:

```tsx
  function endDrag(e: React.PointerEvent<HTMLDivElement>, commit: boolean) {
    if (!pointerStartRef.current || e.pointerId !== pointerStartRef.current.pointerId) return;
    const wasDragging = draggingRef.current;
    const { taskId } = pointerStartRef.current;
    if (wasDragging) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    if (wasDragging && commit && drag && drag.currentTop !== drag.startTop) {
      onReschedule(drag.taskId, drag.currentTop);
    }
    if (!wasDragging && commit) {
      onOpenDetail(taskId);
    }
    resetDragState();
  }
```

- [ ] **Step 2: Stop the checkbox from arming the card's own gesture**

Find:

```tsx
                {item.source === "taska" && item.taskId !== undefined && (
                  <button
                    className={`checkbox${item.done ? " done" : ""}`}
                    aria-label="Позначити виконаним"
                    onClick={() => onToggle(item.taskId as number)}
                  >
                    {item.done && <Check size={12} />}
                  </button>
                )}
```

Replace it with:

```tsx
                {item.source === "taska" && item.taskId !== undefined && (
                  <button
                    className={`checkbox${item.done ? " done" : ""}`}
                    aria-label="Позначити виконаним"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => onToggle(item.taskId as number)}
                  >
                    {item.done && <Check size={12} />}
                  </button>
                )}
```

- [ ] **Step 3: Add a shared open-detail handler in the Calendar page, wire it to Timeline**

In `frontend/app/(app)/calendar/page.tsx`, add this import alongside the existing ones:

```tsx
import { useEditTask } from "@/lib/edit-task-context";
```

Inside `CalendarPage`, alongside the existing `useState` calls, add:

```tsx
  const editTask = useEditTask();
```

Add this function alongside `toggleDone`/`rescheduleTask`:

```tsx
  function handleOpenDetail(task: Task) {
    editTask.open(
      task,
      (updated) => {
        setDayTasks((current) => current.map((t) => (t.id === updated.id ? updated : t)));
        setNoDateTasks((current) => current.map((t) => (t.id === updated.id ? updated : t)));
        setWeekTasks((current) => current.map((t) => (t.id === updated.id ? updated : t)));
        setMonthTasks((current) => current.map((t) => (t.id === updated.id ? updated : t)));
      },
      (deletedId) => {
        setDayTasks((current) => current.filter((t) => t.id !== deletedId));
        setNoDateTasks((current) => current.filter((t) => t.id !== deletedId));
        setWeekTasks((current) => current.filter((t) => t.id !== deletedId));
        setMonthTasks((current) => current.filter((t) => t.id !== deletedId));
      }
    );
  }
```

Find the `<Timeline ... />` element:

```tsx
              <Timeline
                items={timelineItems}
                isToday={isSameDay(selectedDate, new Date())}
                onToggle={(taskId) => {
                  const task = dayTasks.find((t) => t.id === taskId);
                  if (task) toggleDone(task);
                }}
                onReschedule={(taskId, newTop) => {
                  const task = dayTasks.find((t) => t.id === taskId);
                  if (task) rescheduleTask(task, newTop);
                }}
              />
```

Replace it with:

```tsx
              <Timeline
                items={timelineItems}
                isToday={isSameDay(selectedDate, new Date())}
                onToggle={(taskId) => {
                  const task = dayTasks.find((t) => t.id === taskId);
                  if (task) toggleDone(task);
                }}
                onReschedule={(taskId, newTop) => {
                  const task = dayTasks.find((t) => t.id === taskId);
                  if (task) rescheduleTask(task, newTop);
                }}
                onOpenDetail={(taskId) => {
                  const task = dayTasks.find((t) => t.id === taskId);
                  if (task) handleOpenDetail(task);
                }}
              />
```

- [ ] **Step 4: Make the Day tab's all-day and no-date flat rows tappable too**

Find (the "Увесь день" all-day tasks block):

```tsx
                {allDayTasks.map((task) => (
                  <div className="flat-row" key={`task-${task.id}`}>
                    <button
                      className={`checkbox${task.status === "done" ? " done" : ""}`}
                      aria-label="Позначити виконаним"
                      onClick={() => toggleDone(task)}
                    >
                      {task.status === "done" && <Check size={12} />}
                    </button>
                    <div className="flat-title">{task.title}</div>
                  </div>
                ))}
```

Replace it with:

```tsx
                {allDayTasks.map((task) => (
                  <div className="flat-row" key={`task-${task.id}`} onClick={() => handleOpenDetail(task)}>
                    <button
                      className={`checkbox${task.status === "done" ? " done" : ""}`}
                      aria-label="Позначити виконаним"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleDone(task);
                      }}
                    >
                      {task.status === "done" && <Check size={12} />}
                    </button>
                    <div className="flat-title">{task.title}</div>
                  </div>
                ))}
```

Find (the "Без дати" no-date tasks block):

```tsx
                {noDateTasks.map((task) => (
                  <div className="flat-row" key={task.id}>
                    <button
                      className={`checkbox${task.status === "done" ? " done" : ""}`}
                      aria-label="Позначити виконаним"
                      onClick={() => toggleDone(task)}
                    >
                      {task.status === "done" && <Check size={12} />}
                    </button>
                    <div className="flat-title">{task.title}</div>
                  </div>
                ))}
```

Replace it with:

```tsx
                {noDateTasks.map((task) => (
                  <div className="flat-row" key={task.id} onClick={() => handleOpenDetail(task)}>
                    <button
                      className={`checkbox${task.status === "done" ? " done" : ""}`}
                      aria-label="Позначити виконаним"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleDone(task);
                      }}
                    >
                      {task.status === "done" && <Check size={12} />}
                    </button>
                    <div className="flat-title">{task.title}</div>
                  </div>
                ))}
```

- [ ] **Step 5: Verify — build and lint**

```bash
cd frontend && npm run build && npm run lint
```

Expected: both clean, no errors.

- [ ] **Step 6: Verify in the browser**

On the Calendar tab's Day view: quick-tap a timeline card (no hold) — the detail sheet opens with the right task's data. Press-and-hold a card for ~300ms then drag it up/down — it still reschedules on release exactly as before, and the sheet does NOT open. Tap a card's checkbox directly — it toggles done and the sheet does NOT open. Tap a row in "Увесь день" or "Без дати" — the sheet opens; tapping their checkboxes does not. Editing or deleting a task from the sheet is reflected immediately in the Day view.

- [ ] **Step 7: Commit**

```bash
git add frontend/components/timeline/Timeline.tsx "frontend/app/(app)/calendar/page.tsx"
git commit -m "feat(frontend): tap a Calendar Day task to open its detail sheet"
```

---

### Task 4: Calendar Week/Month tabs — tap opens detail

**Files:**
- Modify: `frontend/components/week-list/WeekList.tsx`
- Modify: `frontend/app/(app)/calendar/page.tsx`

**Interfaces:**
- Consumes: `handleOpenDetail(task: Task): void` (Task 3, Step 3, already defined in `calendar/page.tsx`).
- Produces: nothing consumed by later tasks — this is the last task in this plan.

- [ ] **Step 1: Add `onOpenDetail` to `WeekRow` and `WeekList`**

In `frontend/components/week-list/WeekList.tsx`, find:

```tsx
export function WeekRow({ item, onToggle }: { item: WeekItem; onToggle: (taskId: number) => void }) {
  return (
    <div className={`week-row${item.done ? " done" : ""}`}>
      {item.source === "gcal" ? (
        <span className="source-dot gcal" />
      ) : (
        <button className="checkbox" aria-label="Позначити виконаним" onClick={() => onToggle(item.taskId as number)}>
          {item.done && <Check size={10} />}
        </button>
      )}
      <span className="week-time">{item.time ?? "Увесь день"}</span>
      <span className="week-title">{item.title}</span>
    </div>
  );
}
```

Replace it with:

```tsx
export function WeekRow({
  item,
  onToggle,
  onOpenDetail,
}: {
  item: WeekItem;
  onToggle: (taskId: number) => void;
  onOpenDetail: (taskId: number) => void;
}) {
  const clickable = item.source === "taska" && item.taskId !== undefined;
  return (
    <div
      className={`week-row${item.done ? " done" : ""}`}
      style={clickable ? { cursor: "pointer" } : undefined}
      onClick={clickable ? () => onOpenDetail(item.taskId as number) : undefined}
    >
      {item.source === "gcal" ? (
        <span className="source-dot gcal" />
      ) : (
        <button
          className="checkbox"
          aria-label="Позначити виконаним"
          onClick={(e) => {
            e.stopPropagation();
            onToggle(item.taskId as number);
          }}
        >
          {item.done && <Check size={10} />}
        </button>
      )}
      <span className="week-time">{item.time ?? "Увесь день"}</span>
      <span className="week-title">{item.title}</span>
    </div>
  );
}
```

Find:

```tsx
export function WeekList({
  tasks,
  events,
  onToggle,
}: {
  tasks: Task[];
  events: CalendarEvent[];
  onToggle: (taskId: number) => void;
}) {
```

Replace it with:

```tsx
export function WeekList({
  tasks,
  events,
  onToggle,
  onOpenDetail,
}: {
  tasks: Task[];
  events: CalendarEvent[];
  onToggle: (taskId: number) => void;
  onOpenDetail: (taskId: number) => void;
}) {
```

Find:

```tsx
            {dayItems.map((item, i) => (
              <WeekRow key={`${item.source}-${item.taskId ?? i}`} item={item} onToggle={onToggle} />
            ))}
```

Replace it with:

```tsx
            {dayItems.map((item, i) => (
              <WeekRow key={`${item.source}-${item.taskId ?? i}`} item={item} onToggle={onToggle} onOpenDetail={onOpenDetail} />
            ))}
```

- [ ] **Step 2: Wire `onOpenDetail` through the Calendar page's Week and Month tabs**

In `frontend/app/(app)/calendar/page.tsx`, find:

```tsx
        {tab === "week" && <WeekList tasks={weekTasks} events={weekEvents} onToggle={(taskId) => {
          const task = weekTasks.find((t) => t.id === taskId);
          if (task) toggleDone(task);
        }} />}
```

Replace it with:

```tsx
        {tab === "week" && (
          <WeekList
            tasks={weekTasks}
            events={weekEvents}
            onToggle={(taskId) => {
              const task = weekTasks.find((t) => t.id === taskId);
              if (task) toggleDone(task);
            }}
            onOpenDetail={(taskId) => {
              const task = weekTasks.find((t) => t.id === taskId);
              if (task) handleOpenDetail(task);
            }}
          />
        )}
```

Find (the Month tab's day-list `WeekRow` usage):

```tsx
                {monthDayItems.map((item, i) => (
                  <WeekRow
                    key={`${item.source}-${item.taskId ?? i}`}
                    item={item}
                    onToggle={(taskId) => {
                      const task = monthTasks.find((t) => t.id === taskId);
                      if (task) toggleDone(task);
                    }}
                  />
                ))}
```

Replace it with:

```tsx
                {monthDayItems.map((item, i) => (
                  <WeekRow
                    key={`${item.source}-${item.taskId ?? i}`}
                    item={item}
                    onToggle={(taskId) => {
                      const task = monthTasks.find((t) => t.id === taskId);
                      if (task) toggleDone(task);
                    }}
                    onOpenDetail={(taskId) => {
                      const task = monthTasks.find((t) => t.id === taskId);
                      if (task) handleOpenDetail(task);
                    }}
                  />
                ))}
```

- [ ] **Step 3: Verify — build and lint**

```bash
cd frontend && npm run build && npm run lint
```

Expected: both clean, no errors.

- [ ] **Step 4: Verify in the browser**

On the Calendar tab's Week view: tap a Taska task row — the detail sheet opens; tap its checkbox directly — it toggles done without opening the sheet; tap a Google Calendar row (`source: "gcal"`) — nothing happens (not clickable, no cursor change). Switch to the Month view, select a date with tasks, and repeat the same checks in that date's task list below the grid.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/week-list/WeekList.tsx "frontend/app/(app)/calendar/page.tsx"
git commit -m "feat(frontend): tap a Calendar Week/Month task to open its detail sheet"
```

---

## Self-Review

**Spec coverage:** click a task → detail sheet showing priority/date/time (Task 1 Step 4, existing fields only, no new backend field — matches the pre-pause design decision); delete and mark-complete from that sheet (Task 1 Step 4); wired as a tap target everywhere a task row exists — Tasks list (Task 2), Calendar Day timeline + flat rows (Task 3), Week/Month rows (Task 4); Day-tab interaction is quick-tap-opens-detail / hold-and-move-drags, preserving Plan D's drag gesture (Task 3, matches the pre-pause design decision); Inbox's draft-review use of the same sheet is explicitly unaffected (Task 1's `showTaskActions` gate, verified in Task 1 Step 6) — all covered.

**Placeholder scan:** no TBD/TODO; every step has complete, runnable code with exact find/replace blocks.

**Type consistency:** `EditTaskContextValue.open(task: Task, onSaved: (updated: Task) => void, onDeleted?: (taskId: number) => void): void` (Task 1 Step 3) is called with matching arguments in Task 2 Step 1 (`tasks/page.tsx`, both callbacks) and Task 3 Step 3 (`calendar/page.tsx`, both callbacks); Inbox's existing two-argument call site is untouched and remains valid since `onDeleted` is optional. `Timeline`'s new `onOpenDetail: (taskId: number) => void` prop (Task 3 Step 1) is provided at its one call site in Task 3 Step 3. `WeekRow`'s new `onOpenDetail: (taskId: number) => void` prop (Task 4 Step 1) is provided at both its call sites (Week tab via `WeekList`, Month tab directly) in Task 4 Step 2. `handleOpenDetail(task: Task): void`, defined once in Task 3 Step 3, is reused unchanged by Task 4 Step 2 — no redefinition, no signature drift.
