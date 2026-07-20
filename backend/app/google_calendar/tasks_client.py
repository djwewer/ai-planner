import datetime

import httpx

from app.google_calendar.client import _get_access_token
from app.models import User

TASKS_API_BASE = "https://www.googleapis.com/tasks/v1"
DEFAULT_TASKLIST = "@default"


def _due_timestamp(due: datetime.date) -> str:
    return f"{due.isoformat()}T00:00:00.000Z"


def create_task(user: User, title: str, due: datetime.date, completed: bool = False) -> str:
    access_token = _get_access_token(user)
    response = httpx.post(
        f"{TASKS_API_BASE}/lists/{DEFAULT_TASKLIST}/tasks",
        headers={"Authorization": f"Bearer {access_token}"},
        json={
            "title": title,
            "due": _due_timestamp(due),
            "status": "completed" if completed else "needsAction",
        },
    )
    response.raise_for_status()
    return response.json()["id"]


def update_task(
    user: User, google_task_id: str, title: str, due: datetime.date, completed: bool = False
) -> None:
    access_token = _get_access_token(user)
    response = httpx.patch(
        f"{TASKS_API_BASE}/lists/{DEFAULT_TASKLIST}/tasks/{google_task_id}",
        headers={"Authorization": f"Bearer {access_token}"},
        json={
            "title": title,
            "due": _due_timestamp(due),
            "status": "completed" if completed else "needsAction",
        },
    )
    response.raise_for_status()


def delete_task(user: User, google_task_id: str) -> None:
    access_token = _get_access_token(user)
    response = httpx.delete(
        f"{TASKS_API_BASE}/lists/{DEFAULT_TASKLIST}/tasks/{google_task_id}",
        headers={"Authorization": f"Bearer {access_token}"},
    )
    if response.status_code not in (200, 204, 404):
        response.raise_for_status()
