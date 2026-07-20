import datetime
import logging
import secrets

from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models import TelegramLinkCode, User
from app.security import get_current_user
from app.telegram import client as telegram_client

logger = logging.getLogger(__name__)

router = APIRouter(tags=["telegram"])

LINK_CODE_EXPIRY_MINUTES = 10
CODE_INVALID_MESSAGE = "Код недійсний або застарів, спробуйте ще раз у Налаштуваннях."


@router.get("/telegram/connect")
def connect(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    code = secrets.token_urlsafe(16)
    db.add(
        TelegramLinkCode(
            code=code,
            user_id=current_user.id,
            expires_at=datetime.datetime.utcnow()
            + datetime.timedelta(minutes=LINK_CODE_EXPIRY_MINUTES),
            used=False,
        )
    )
    db.commit()
    return {"deep_link": f"https://t.me/{settings.telegram_bot_username}?start={code}"}


def _handle_start(chat_id: int, code: str, db: Session) -> None:
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


@router.post("/telegram/webhook")
def webhook(
    body: dict,
    db: Session = Depends(get_db),
    x_telegram_bot_api_secret_token: str | None = Header(default=None),
):
    if x_telegram_bot_api_secret_token != settings.telegram_webhook_secret:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid secret token"
        )

    message = body.get("message")
    if message is not None:
        text = message.get("text", "")
        chat_id = message["chat"]["id"]
        if text.startswith("/start "):
            code = text[len("/start ") :].strip()
            try:
                _handle_start(chat_id, code, db)
            except Exception:
                logger.exception("failed to handle /start for chat_id=%s", chat_id)
        return {"ok": True}

    return {"ok": True}
