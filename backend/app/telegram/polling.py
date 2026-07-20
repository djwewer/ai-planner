import logging
import threading

from app.database import SessionLocal
from app.telegram import client as telegram_client
from app.telegram.handlers import handle_update

logger = logging.getLogger(__name__)

POLL_TIMEOUT_SECONDS = 30
ERROR_RETRY_DELAY_SECONDS = 5
ALLOWED_UPDATES = ["message", "callback_query"]

_stop_event = threading.Event()
_thread: threading.Thread | None = None


def _poll_loop() -> None:
    offset: int | None = None
    while not _stop_event.is_set():
        try:
            updates = telegram_client.get_updates(
                offset, timeout=POLL_TIMEOUT_SECONDS, allowed_updates=ALLOWED_UPDATES
            )
        except Exception:
            logger.exception("failed to fetch Telegram updates")
            _stop_event.wait(ERROR_RETRY_DELAY_SECONDS)
            continue

        for update in updates:
            offset = update["update_id"] + 1
            db = SessionLocal()
            try:
                handle_update(update, db)
            except Exception:
                logger.exception(
                    "failed to handle Telegram update_id=%s", update.get("update_id")
                )
            finally:
                db.close()


def start() -> None:
    global _thread
    _stop_event.clear()
    _thread = threading.Thread(target=_poll_loop, name="telegram-polling", daemon=True)
    _thread.start()


def stop() -> None:
    _stop_event.set()
