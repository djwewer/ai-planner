from app.config import settings
from app.models import Task, User
from app.telegram import client as telegram_client

MAX_INLINE_TASKS = 5

STATUS_LABELS = {
    "confirmed": "✅ Підтверджено",
    "rejected": "❌ Відхилено",
}


def _format_deadline_line(task: Task) -> str:
    if task.scheduled_at is not None:
        return (
            f"📅Дедлайн: {task.scheduled_at.strftime('%H:%M')}, "
            f"{task.scheduled_at.strftime('%d.%m.%Y')}"
        )
    if task.deadline is not None:
        return f"📅Дедлайн: {task.deadline.strftime('%d.%m.%Y')}"
    return "📝Задача без дедлайну"


def render_batch_message(tasks: list[Task]) -> tuple[str, dict | None]:
    shown = tasks[:MAX_INLINE_TASKS]
    blocks = ["Привіт! Ось нові задачі для підтвердження:"]
    keyboard_rows = []
    any_resolved = False

    for task in shown:
        label = STATUS_LABELS.get(task.status)
        if label is not None:
            any_resolved = True
            blocks.append(f"— {task.title}: {label}")
        else:
            blocks.append(f"— {task.title}\n{_format_deadline_line(task)}")
            keyboard_rows.append(
                [
                    {"text": "✅", "callback_data": f"approve:{task.id}"},
                    {"text": "❌", "callback_data": f"reject:{task.id}"},
                ]
            )

    remaining = len(tasks) - len(shown)
    if remaining > 0:
        blocks.append(f"...і ще {remaining} — переглянути в Inbox")

    text = "\n\n".join(blocks)

    if any_resolved:
        keyboard_rows.append(
            [
                {
                    "text": "Переглянути задачі в застосунку",
                    "url": f"{settings.frontend_url}/tasks",
                }
            ]
        )

    reply_markup = {"inline_keyboard": keyboard_rows} if keyboard_rows else None
    return text, reply_markup


def notify_new_tasks_ready(user: User, tasks: list[Task]) -> None:
    if user.telegram_chat_id is None or not tasks:
        return
    text, reply_markup = render_batch_message(tasks)
    telegram_client.send_message(user.telegram_chat_id, text, reply_markup=reply_markup)
