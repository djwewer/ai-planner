import datetime
import logging

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.ai.triage import extract_tasks
from app.database import get_db
from app.models import Capture, Task, User
from app.schemas import TaskOut
from app.security import get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/captures", tags=["captures"])


class CaptureCreate(BaseModel):
    raw_text: str = Field(min_length=1)


@router.post("", response_model=list[TaskOut], status_code=status.HTTP_201_CREATED)
def create_capture(
    payload: CaptureCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    capture = Capture(user_id=current_user.id, raw_text=payload.raw_text, status="processing")
    db.add(capture)
    db.commit()
    db.refresh(capture)

    try:
        extracted = extract_tasks(payload.raw_text, datetime.date.today())
    except Exception:
        logger.exception("triage failed for capture_id=%s", capture.id)
        capture.status = "failed"
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Не вдалося обробити, спробуйте ще раз",
        )

    capture.status = "complete"
    db.commit()

    tasks = []
    for item in extracted:
        task = Task(
            user_id=current_user.id,
            capture_id=capture.id,
            title=item.title,
            priority=item.priority,
            deadline=item.deadline,
            scheduled_at=item.scheduled_at,
            status="draft",
        )
        db.add(task)
        tasks.append(task)
    db.commit()
    for task in tasks:
        db.refresh(task)
    return tasks
