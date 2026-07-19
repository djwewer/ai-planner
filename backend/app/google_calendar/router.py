import logging

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.google_calendar import client as google_calendar_client
from app.google_calendar.oauth import calendar_oauth
from app.models import User
from app.security import get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(tags=["calendar"])


@router.get("/auth/google/calendar/connect")
async def connect(request: Request, current_user: User = Depends(get_current_user)):
    request.session["calendar_connect_user_id"] = current_user.id
    rv = await calendar_oauth.google_calendar.create_authorization_url(
        settings.google_calendar_redirect_uri
    )
    await calendar_oauth.google_calendar.save_authorize_data(
        request, redirect_uri=settings.google_calendar_redirect_uri, **rv
    )
    return {"authorize_url": rv["url"]}


@router.get("/auth/google/calendar/callback")
async def callback(request: Request, db: Session = Depends(get_db)):
    user_id = request.session.pop("calendar_connect_user_id", None)
    if user_id is None:
        return RedirectResponse(
            url=f"{settings.frontend_url}/settings?error=calendar_connect_failed"
        )

    try:
        token = await calendar_oauth.google_calendar.authorize_access_token(request)
    except Exception:
        logger.exception("calendar OAuth callback failed for user_id=%s", user_id)
        return RedirectResponse(
            url=f"{settings.frontend_url}/settings?error=calendar_connect_failed"
        )

    refresh_token = token.get("refresh_token")
    if refresh_token is None:
        return RedirectResponse(
            url=f"{settings.frontend_url}/settings?error=calendar_connect_failed"
        )

    user = db.query(User).filter(User.id == user_id).first()
    if user is not None:
        user.google_calendar_refresh_token = refresh_token
        db.commit()

    return RedirectResponse(url=f"{settings.frontend_url}/settings?connected=1")


@router.get("/calendar/events")
def list_calendar_events(
    start: str = Query(...),
    end: str = Query(...),
    current_user: User = Depends(get_current_user),
):
    import datetime

    if current_user.google_calendar_refresh_token is None:
        return {"events": []}
    try:
        start_dt = datetime.datetime.fromisoformat(start)
        end_dt = datetime.datetime.fromisoformat(end)
        events = google_calendar_client.list_events(current_user, start_dt, end_dt)
    except Exception:
        logger.exception("failed to list calendar events for user_id=%s", current_user.id)
        return {"events": []}
    return {
        "events": [
            {
                "id": e["id"],
                "title": e.get("summary", ""),
                "start": e.get("start", {}).get("dateTime") or e.get("start", {}).get("date"),
                "end": e.get("end", {}).get("dateTime") or e.get("end", {}).get("date"),
            }
            for e in events
        ]
    }
