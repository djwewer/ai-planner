import datetime
import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.database import get_db
from app.google_calendar import client as google_calendar_client
from app.models import Task, User
from app.schemas import TaskCreate, TaskOut, TaskUpdate
from app.security import get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/tasks", tags=["tasks"])


def _sync_task_calendar(current_user: User, task: Task, db: Session) -> None:
    if task.scheduled_at is None:
        if task.google_event_id is not None:
            try:
                google_calendar_client.delete_event(current_user, task.google_event_id)
            except Exception:
                logger.exception("failed to delete calendar event for task_id=%s", task.id)
                return
            task.google_event_id = None
            db.commit()
        return

    if task.status not in ("confirmed", "done"):
        return
    if current_user.google_calendar_refresh_token is None:
        return

    try:
        if task.google_event_id is None:
            task.google_event_id = google_calendar_client.create_event(
                current_user, task.title, task.scheduled_at
            )
        else:
            google_calendar_client.update_event(
                current_user, task.google_event_id, task.title, task.scheduled_at
            )
        db.commit()
    except Exception:
        logger.exception("failed to sync calendar event for task_id=%s", task.id)


@router.post("", response_model=TaskOut, status_code=status.HTTP_201_CREATED)
def create_task(
    payload: TaskCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    task = Task(user_id=current_user.id, **payload.model_dump())
    db.add(task)
    db.commit()
    db.refresh(task)
    _sync_task_calendar(current_user, task, db)
    return task


@router.get("", response_model=List[TaskOut])
def list_tasks(
    status_filter: Optional[str] = Query(default=None, alias="status"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    query = db.query(Task).filter(Task.user_id == current_user.id)
    if status_filter is not None:
        query = query.filter(Task.status == status_filter)
    else:
        query = query.filter(Task.status.in_(["confirmed", "done"]))
    return query.order_by(Task.created_at.desc()).all()


@router.get("/today", response_model=List[TaskOut])
def list_today_tasks(
    current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    today = datetime.date.today()
    return (
        db.query(Task)
        .filter(
            Task.user_id == current_user.id,
            Task.status.in_(["confirmed", "done"]),
            Task.deadline.isnot(None),
            Task.deadline <= today,
        )
        .order_by(Task.scheduled_at.asc().nullslast(), Task.priority.asc(), Task.deadline.asc())
        .all()
    )


@router.get("/calendar", response_model=List[TaskOut])
def list_calendar_tasks(
    start: datetime.date = Query(...),
    end: datetime.date = Query(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    start_dt = datetime.datetime.combine(start, datetime.time.min)
    end_dt = datetime.datetime.combine(end, datetime.time.max)
    return (
        db.query(Task)
        .filter(
            Task.user_id == current_user.id,
            Task.status.in_(["confirmed", "done"]),
            or_(
                Task.scheduled_at.between(start_dt, end_dt),
                Task.deadline.between(start, end),
            ),
        )
        .order_by(Task.scheduled_at.asc().nullslast())
        .all()
    )


def _get_owned_task(task_id: int, current_user: User, db: Session) -> Task:
    task = db.query(Task).filter(Task.id == task_id).first()
    if task is None or task.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Задачу не знайдено")
    return task


@router.get("/{task_id}/schedule-suggestions")
def schedule_suggestions(
    task_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    task = _get_owned_task(task_id, current_user, db)
    if current_user.google_calendar_refresh_token is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Спочатку підключіть Google Calendar у Налаштуваннях",
        )
    target_date = task.deadline or datetime.date.today()
    try:
        busy = google_calendar_client.get_free_busy(current_user, target_date)
    except Exception:
        logger.exception("failed to fetch free/busy for task_id=%s", task.id)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Не вдалося перевірити календар, спробуйте ще раз",
        )
    slots = google_calendar_client.suggest_free_slots(busy, target_date)
    return {"slots": [slot.isoformat() for slot in slots]}


@router.patch("/{task_id}", response_model=TaskOut)
def update_task(
    task_id: int,
    payload: TaskUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    task = _get_owned_task(task_id, current_user, db)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(task, field, value)
    db.commit()
    db.refresh(task)
    _sync_task_calendar(current_user, task, db)
    return task


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_task(
    task_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    task = _get_owned_task(task_id, current_user, db)
    if task.google_event_id is not None:
        try:
            google_calendar_client.delete_event(current_user, task.google_event_id)
        except Exception:
            logger.exception("failed to delete calendar event for task_id=%s", task.id)
    db.delete(task)
    db.commit()
