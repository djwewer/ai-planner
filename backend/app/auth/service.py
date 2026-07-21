import logging

from sqlalchemy.orm import Session

from app.google_calendar import client as google_calendar_client
from app.google_calendar import tasks_client as google_tasks_client
from app.models import Capture, Task, TelegramLinkCode, User
from app.telegram import client as telegram_client

logger = logging.getLogger(__name__)


def delete_account(user: User, remove_google_events: bool, db: Session) -> None:
    tasks = db.query(Task).filter(Task.user_id == user.id).all()

    if remove_google_events:
        for task in tasks:
            if task.google_event_id is not None:
                try:
                    google_calendar_client.delete_event(user, task.google_event_id)
                except Exception:
                    logger.exception(
                        "failed to delete calendar event for task_id=%s during account deletion",
                        task.id,
                    )
            if task.google_task_id is not None:
                try:
                    google_tasks_client.delete_task(user, task.google_task_id)
                except Exception:
                    logger.exception(
                        "failed to delete google task for task_id=%s during account deletion",
                        task.id,
                    )

    if user.telegram_chat_id is not None:
        try:
            telegram_client.send_message(
                user.telegram_chat_id,
                "Ваш акаунт Tenoa видалено. Дякуємо, що користувалися сервісом!",
            )
        except Exception:
            logger.exception(
                "failed to send account-deletion notice to chat_id=%s", user.telegram_chat_id
            )

    for task in tasks:
        db.delete(task)
    db.flush()

    db.query(Capture).filter(Capture.user_id == user.id).delete(synchronize_session=False)
    db.query(TelegramLinkCode).filter(TelegramLinkCode.user_id == user.id).delete(
        synchronize_session=False
    )
    db.delete(user)
    db.commit()
