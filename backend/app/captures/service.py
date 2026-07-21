import datetime
import logging
from dataclasses import dataclass, field
from typing import Literal, Optional

from sqlalchemy.orm import Session

from app.ai.replan import CandidateTask, find_reschedule_target
from app.ai.triage import extract_tasks
from app.models import Capture, Task, User
from app.tasks.router import _sync_task_google
from app.telegram.notifications import notify_new_tasks_ready

logger = logging.getLogger(__name__)

MAX_CANDIDATE_TASKS = 150


class CaptureProcessingError(Exception):
    """Raised when AI processing fails; the caller decides how to surface it."""


@dataclass
class CaptureResult:
    kind: Literal["created", "rescheduled", "not_found"]
    tasks: list[Task] = field(default_factory=list)
    task: Optional[Task] = None


def _fetch_candidate_tasks(user: User, db: Session) -> list[CandidateTask]:
    rows = (
        db.query(Task)
        .filter(Task.user_id == user.id, Task.status.in_(["confirmed", "done"]))
        .order_by(Task.updated_at.desc())
        .limit(MAX_CANDIDATE_TASKS)
        .all()
    )
    return [
        CandidateTask(id=t.id, title=t.title, deadline=t.deadline, scheduled_at=t.scheduled_at)
        for t in rows
    ]


def process_capture(user: User, raw_text: str, source: str, db: Session) -> CaptureResult:
    capture = Capture(user_id=user.id, raw_text=raw_text, status="processing", source=source)
    db.add(capture)
    db.commit()
    db.refresh(capture)

    candidate_tasks = _fetch_candidate_tasks(user, db)

    try:
        replan = find_reschedule_target(raw_text, datetime.date.today(), candidate_tasks)
    except Exception:
        logger.exception("replan classification failed for capture_id=%s", capture.id)
        capture.status = "failed"
        db.commit()
        raise CaptureProcessingError("replan classification failed") from None

    if replan.kind == "reschedule":
        task = db.query(Task).filter(Task.id == replan.task_id, Task.user_id == user.id).first()
        if task is None:
            logger.warning(
                "replan matched task_id=%s not found/owned for capture_id=%s",
                replan.task_id,
                capture.id,
            )
            capture.status = "invalid_match"
            db.commit()
            return CaptureResult(kind="not_found")

        if replan.new_deadline is None and replan.new_scheduled_at is None:
            logger.warning(
                "replan matched task_id=%s with no new date for capture_id=%s -- refusing to clear its schedule",
                replan.task_id,
                capture.id,
            )
            capture.status = "invalid_match"
            db.commit()
            return CaptureResult(kind="not_found")

        task.deadline = replan.new_deadline
        task.scheduled_at = replan.new_scheduled_at
        db.commit()
        db.refresh(task)
        _sync_task_google(user, task, db)

        capture.status = "rescheduled"
        db.commit()

        return CaptureResult(kind="rescheduled", task=task)

    if replan.kind == "no_match":
        capture.status = "no_match"
        db.commit()
        return CaptureResult(kind="not_found")

    # replan.kind == "not_a_reschedule" -- fall through to the existing create-flow.
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

    return CaptureResult(kind="created", tasks=tasks)
