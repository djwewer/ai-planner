import datetime
import logging

from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models import Task, User
from app.telegram import client as telegram_client

logger = logging.getLogger(__name__)

REMINDER_LOOKBACK_MINUTES = 15


def send_scheduled_reminders() -> None:
    db = SessionLocal()
    try:
        now = datetime.datetime.now()
        lower_bound = now - datetime.timedelta(minutes=REMINDER_LOOKBACK_MINUTES)
        tasks = (
            db.query(Task)
            .join(User, Task.user_id == User.id)
            .filter(
                Task.status == "confirmed",
                Task.scheduled_at.isnot(None),
                Task.scheduled_at >= lower_bound,
                Task.scheduled_at <= now,
                Task.reminder_sent_at.is_(None),
                User.telegram_chat_id.isnot(None),
            )
            .all()
        )
        for task in tasks:
            try:
                time_label = task.scheduled_at.strftime("%H:%M")
                telegram_client.send_message(
                    task.user.telegram_chat_id, f"⏰ {time_label} — {task.title}"
                )
                task.reminder_sent_at = now
                db.commit()
            except Exception:
                logger.exception("failed to send scheduled reminder for task_id=%s", task.id)
    finally:
        db.close()


def _send_digest_for_user(user: User, today: datetime.date, db: Session) -> None:
    tasks = (
        db.query(Task)
        .filter(
            Task.user_id == user.id,
            Task.status.in_(["confirmed", "done"]),
            Task.deadline.isnot(None),
            Task.deadline <= today,
        )
        .order_by(Task.scheduled_at.asc().nullslast(), Task.priority.asc(), Task.deadline.asc())
        .all()
    )
    if not tasks:
        return
    lines = ["☀️ На сьогодні:"]
    for task in tasks:
        prefix = f"{task.scheduled_at.strftime('%H:%M')} " if task.scheduled_at else ""
        lines.append(f"- {prefix}{task.title} (P{task.priority})")
    try:
        telegram_client.send_message(user.telegram_chat_id, "\n".join(lines))
    except Exception:
        logger.exception("failed to send morning digest for user_id=%s", user.id)


def _send_overdue_nudges_for_user(
    user: User, now: datetime.datetime, today: datetime.date, db: Session
) -> None:
    confirmed_tasks = db.query(Task).filter(Task.user_id == user.id, Task.status == "confirmed").all()
    overdue = [
        task
        for task in confirmed_tasks
        if (
            (task.deadline is not None and task.deadline < today)
            or (task.scheduled_at is not None and task.scheduled_at < now)
        )
        and (task.last_overdue_nudge_at is None or task.last_overdue_nudge_at.date() < today)
    ]
    if not overdue:
        return
    lines = ["⚠️ Просрочено:"]
    for task in overdue:
        when = (
            task.deadline.strftime("%d.%m")
            if task.deadline is not None
            else task.scheduled_at.strftime("%d.%m")
        )
        lines.append(f"- {task.title} (термін був {when})")
    try:
        telegram_client.send_message(user.telegram_chat_id, "\n".join(lines))
    except Exception:
        logger.exception("failed to send overdue nudges for user_id=%s", user.id)
        return
    for task in overdue:
        task.last_overdue_nudge_at = now
    db.commit()


def send_daily_digest_and_overdue_nudges() -> None:
    db = SessionLocal()
    try:
        now = datetime.datetime.now()
        today = now.date()
        users = db.query(User).filter(User.telegram_chat_id.isnot(None)).all()
        for user in users:
            _send_digest_for_user(user, today, db)
            _send_overdue_nudges_for_user(user, now, today, db)
    finally:
        db.close()
