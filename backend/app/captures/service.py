import datetime
import logging

from sqlalchemy.orm import Session

from app.ai.triage import extract_tasks
from app.models import Capture, Task, User
from app.telegram.notifications import notify_new_tasks_ready

logger = logging.getLogger(__name__)


class CaptureProcessingError(Exception):
    """Raised when AI triage fails; the caller decides how to surface it."""


def process_capture(user: User, raw_text: str, source: str, db: Session) -> list[Task]:
    capture = Capture(user_id=user.id, raw_text=raw_text, status="processing", source=source)
    db.add(capture)
    db.commit()
    db.refresh(capture)

    try:
        extracted = extract_tasks(raw_text, datetime.date.today())
    except Exception:
        logger.exception("triage failed for capture_id=%s", capture.id)
        capture.status = "failed"
        db.commit()
        raise CaptureProcessingError("triage failed") from None

    capture.status = "complete"
    db.commit()

    tasks = []
    for item in extracted:
        task = Task(
            user_id=user.id,
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

    if source == "telegram":
        try:
            notify_new_tasks_ready(user, tasks)
        except Exception:
            logger.exception(
                "failed to send new-tasks-ready notification for capture_id=%s", capture.id
            )

    return tasks
