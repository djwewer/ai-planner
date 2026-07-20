import datetime
import logging

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import Task, TelegramLinkCode, User
from app.tasks.router import _sync_task_google
from app.telegram import client as telegram_client
from app.telegram.notifications import render_batch_message

logger = logging.getLogger(__name__)

CODE_INVALID_MESSAGE = "Код недійсний або застарів, спробуйте ще раз у Налаштуваннях."


def handle_start(chat_id: int, code: str, db: Session) -> None:
    link_code = (
        db.query(TelegramLinkCode)
        .filter(TelegramLinkCode.code == code, TelegramLinkCode.used.is_(False))
        .first()
    )
    if link_code is None or link_code.expires_at < datetime.datetime.utcnow():
        telegram_client.send_message(chat_id, CODE_INVALID_MESSAGE)
        return

    user = db.query(User).filter(User.id == link_code.user_id).first()
    if user is None:
        telegram_client.send_message(chat_id, CODE_INVALID_MESSAGE)
        return

    user.telegram_chat_id = chat_id
    link_code.used = True
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        telegram_client.send_message(
            chat_id, "Цей Telegram акаунт вже підключено до іншого користувача."
        )
        return

    telegram_client.send_message(chat_id, "✅ Підключено!")


def handle_callback_query(callback_query: dict, db: Session) -> None:
    callback_query_id = callback_query["id"]
    data = callback_query.get("data", "")
    chat_id = callback_query["message"]["chat"]["id"]
    message_id = callback_query["message"]["message_id"]

    try:
        action, task_id_str = data.split(":", 1)
        task_id = int(task_id_str)
    except ValueError:
        telegram_client.answer_callback_query(callback_query_id)
        return

    task = db.query(Task).filter(Task.id == task_id).first()
    if task is None or task.user.telegram_chat_id != chat_id:
        telegram_client.answer_callback_query(callback_query_id, "Задачу не знайдено")
        return

    if task.status == "draft" and action == "approve":
        task.status = "confirmed"
        db.commit()
        _sync_task_google(task.user, task, db)
    elif task.status == "draft" and action == "reject":
        task.status = "rejected"
        db.commit()

    batch_tasks = (
        db.query(Task)
        .filter(Task.capture_id == task.capture_id, Task.user_id == task.user_id)
        .order_by(Task.id.asc())
        .all()
    )
    text, reply_markup = render_batch_message(batch_tasks)
    telegram_client.edit_message(chat_id, message_id, text, reply_markup=reply_markup)
    telegram_client.answer_callback_query(callback_query_id)


def handle_update(update: dict, db: Session) -> None:
    message = update.get("message")
    if message is not None:
        try:
            text = message.get("text", "")
            chat_id = message["chat"]["id"]
            if text.startswith("/start "):
                code = text[len("/start ") :].strip()
                handle_start(chat_id, code, db)
        except Exception:
            logger.exception("failed to handle message update")
        return

    callback_query = update.get("callback_query")
    if callback_query is not None:
        try:
            handle_callback_query(callback_query, db)
        except Exception:
            logger.exception("failed to handle callback_query")
        return
