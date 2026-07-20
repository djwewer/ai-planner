from app.models import Task, User
from app.telegram import client as telegram_client

MAX_INLINE_TASKS = 5

STATUS_LABELS = {
    "confirmed": "✅ Підтверджено",
    "rejected": "❌ Відхилено",
}


def render_batch_message(tasks: list[Task]) -> tuple[str, dict | None]:
    shown = tasks[:MAX_INLINE_TASKS]
    lines = [f"🆕 {len(tasks)} нових задач готові до перегляду"]
    keyboard_rows = []

    for task in shown:
        label = STATUS_LABELS.get(task.status)
        if label is not None:
            lines.append(f"— {task.title}: {label}")
        else:
            lines.append(f"— {task.title}")
            keyboard_rows.append(
                [
                    {"text": "✅", "callback_data": f"approve:{task.id}"},
                    {"text": "❌", "callback_data": f"reject:{task.id}"},
                ]
            )

    remaining = len(tasks) - len(shown)
    if remaining > 0:
        lines.append(f"...і ще {remaining} — переглянути в Inbox")

    text = "\n".join(lines)
    reply_markup = {"inline_keyboard": keyboard_rows} if keyboard_rows else None
    return text, reply_markup


def notify_new_tasks_ready(user: User, tasks: list[Task]) -> None:
    if user.telegram_chat_id is None or not tasks:
        return
    text, reply_markup = render_batch_message(tasks)
    telegram_client.send_message(user.telegram_chat_id, text, reply_markup=reply_markup)
