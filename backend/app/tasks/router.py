import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Task, User
from app.schemas import TaskCreate, TaskOut, TaskUpdate
from app.security import get_current_user

router = APIRouter(prefix="/tasks", tags=["tasks"])


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
        .order_by(Task.priority.asc(), Task.deadline.asc())
        .all()
    )


def _get_owned_task(task_id: int, current_user: User, db: Session) -> Task:
    task = db.query(Task).filter(Task.id == task_id).first()
    if task is None or task.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    return task


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
    return task


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_task(
    task_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    task = _get_owned_task(task_id, current_user, db)
    db.delete(task)
    db.commit()
