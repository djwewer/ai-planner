import datetime
import secrets

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models import TelegramLinkCode, User
from app.security import get_current_user

router = APIRouter(tags=["telegram"])

LINK_CODE_EXPIRY_MINUTES = 10


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
