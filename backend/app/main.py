import logging
from contextlib import asynccontextmanager

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.sessions import SessionMiddleware

from app.auth.router import router as auth_router
from app.captures.router import router as captures_router
from app.config import settings
from app.google_calendar.router import router as google_calendar_router
from app.tasks.router import router as tasks_router
from app.telegram import polling as telegram_polling
from app.telegram.router import router as telegram_router
from app.telegram.scheduler import send_daily_digest_and_overdue_nudges, send_scheduled_reminders
from app.transcription.router import router as transcription_router

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")

scheduler = BackgroundScheduler()


@asynccontextmanager
async def lifespan(app: FastAPI):
    scheduler.add_job(
        send_scheduled_reminders, "interval", minutes=1, id="telegram_reminders"
    )
    scheduler.add_job(
        send_daily_digest_and_overdue_nudges,
        CronTrigger(hour=9, minute=0, timezone="Europe/Kyiv"),
        id="telegram_daily_digest",
    )
    scheduler.start()
    telegram_polling.start()
    yield
    telegram_polling.stop()
    scheduler.shutdown()


app = FastAPI(title="AI Planner API", lifespan=lifespan)

_frontend_is_https = settings.frontend_url.startswith("https://")
app.add_middleware(
    SessionMiddleware,
    secret_key=settings.jwt_secret,
    same_site="none" if _frontend_is_https else "lax",
    https_only=_frontend_is_https,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_url],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(tasks_router)
app.include_router(captures_router)
app.include_router(transcription_router)
app.include_router(google_calendar_router)
app.include_router(telegram_router)


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    return JSONResponse(status_code=422, content={"detail": "Перевірте введені дані"})


@app.get("/health")
def health():
    return {"status": "ok"}
