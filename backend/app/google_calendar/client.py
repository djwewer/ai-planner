import datetime
import logging

import httpx

from app.config import settings
from app.models import User

logger = logging.getLogger(__name__)

TOKEN_URL = "https://oauth2.googleapis.com/token"
CALENDAR_API_BASE = "https://www.googleapis.com/calendar/v3"
EVENT_DURATION_MINUTES = 30
WORKING_HOURS_START = 9
WORKING_HOURS_END = 18
SLOT_STEP_MINUTES = 30
MAX_SUGGESTIONS = 3


def _get_access_token(user: User) -> str:
    if not user.google_calendar_refresh_token:
        raise ValueError("user has not connected Google Calendar")
    response = httpx.post(
        TOKEN_URL,
        data={
            "client_id": settings.google_client_id,
            "client_secret": settings.google_client_secret,
            "refresh_token": user.google_calendar_refresh_token,
            "grant_type": "refresh_token",
        },
    )
    response.raise_for_status()
    return response.json()["access_token"]


def get_free_busy(
    user: User, date: datetime.date
) -> list[tuple[datetime.datetime, datetime.datetime]]:
    access_token = _get_access_token(user)
    time_min = datetime.datetime.combine(date, datetime.time.min)
    time_max = datetime.datetime.combine(date, datetime.time.max)
    response = httpx.post(
        f"{CALENDAR_API_BASE}/freeBusy",
        headers={"Authorization": f"Bearer {access_token}"},
        json={
            "timeMin": time_min.isoformat() + "Z",
            "timeMax": time_max.isoformat() + "Z",
            "items": [{"id": "primary"}],
        },
    )
    response.raise_for_status()
    busy_raw = response.json()["calendars"]["primary"]["busy"]
    return [
        (
            datetime.datetime.fromisoformat(b["start"].replace("Z", "+00:00")),
            datetime.datetime.fromisoformat(b["end"].replace("Z", "+00:00")),
        )
        for b in busy_raw
    ]


def suggest_free_slots(
    busy: list[tuple[datetime.datetime, datetime.datetime]], date: datetime.date
) -> list[datetime.datetime]:
    slots: list[datetime.datetime] = []
    current = datetime.datetime.combine(date, datetime.time(hour=WORKING_HOURS_START))
    end_of_day = datetime.datetime.combine(date, datetime.time(hour=WORKING_HOURS_END))
    while current < end_of_day and len(slots) < MAX_SUGGESTIONS:
        slot_end = current + datetime.timedelta(minutes=EVENT_DURATION_MINUTES)
        overlaps = any(current < b_end and slot_end > b_start for b_start, b_end in busy)
        if not overlaps:
            slots.append(current)
        current += datetime.timedelta(minutes=SLOT_STEP_MINUTES)
    return slots


def create_event(user: User, title: str, scheduled_at: datetime.datetime) -> str:
    access_token = _get_access_token(user)
    end = scheduled_at + datetime.timedelta(minutes=EVENT_DURATION_MINUTES)
    response = httpx.post(
        f"{CALENDAR_API_BASE}/calendars/primary/events",
        headers={"Authorization": f"Bearer {access_token}"},
        json={
            "summary": title,
            "start": {"dateTime": scheduled_at.isoformat()},
            "end": {"dateTime": end.isoformat()},
        },
    )
    response.raise_for_status()
    return response.json()["id"]


def update_event(
    user: User, google_event_id: str, title: str, scheduled_at: datetime.datetime
) -> None:
    access_token = _get_access_token(user)
    end = scheduled_at + datetime.timedelta(minutes=EVENT_DURATION_MINUTES)
    response = httpx.patch(
        f"{CALENDAR_API_BASE}/calendars/primary/events/{google_event_id}",
        headers={"Authorization": f"Bearer {access_token}"},
        json={
            "summary": title,
            "start": {"dateTime": scheduled_at.isoformat()},
            "end": {"dateTime": end.isoformat()},
        },
    )
    response.raise_for_status()


def delete_event(user: User, google_event_id: str) -> None:
    access_token = _get_access_token(user)
    response = httpx.delete(
        f"{CALENDAR_API_BASE}/calendars/primary/events/{google_event_id}",
        headers={"Authorization": f"Bearer {access_token}"},
    )
    if response.status_code not in (200, 204, 404):
        response.raise_for_status()


def list_events(user: User, start: datetime.datetime, end: datetime.datetime) -> list[dict]:
    access_token = _get_access_token(user)
    response = httpx.get(
        f"{CALENDAR_API_BASE}/calendars/primary/events",
        headers={"Authorization": f"Bearer {access_token}"},
        params={
            "timeMin": start.isoformat() + ("Z" if start.tzinfo is None else ""),
            "timeMax": end.isoformat() + ("Z" if end.tzinfo is None else ""),
            "singleEvents": "true",
            "orderBy": "startTime",
        },
    )
    response.raise_for_status()
    return response.json().get("items", [])
