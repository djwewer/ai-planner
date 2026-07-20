import httpx

from app.config import settings


def _api_url(method: str) -> str:
    return f"https://api.telegram.org/bot{settings.telegram_bot_token}/{method}"


def send_message(chat_id: int, text: str, reply_markup: dict | None = None) -> dict:
    payload: dict = {"chat_id": chat_id, "text": text}
    if reply_markup is not None:
        payload["reply_markup"] = reply_markup
    response = httpx.post(_api_url("sendMessage"), json=payload)
    try:
        response.raise_for_status()
    except httpx.HTTPStatusError as e:
        raise RuntimeError(f"Telegram API error {e.response.status_code}") from None
    return response.json()["result"]


def edit_message(
    chat_id: int, message_id: int, text: str, reply_markup: dict | None = None
) -> None:
    payload: dict = {"chat_id": chat_id, "message_id": message_id, "text": text}
    if reply_markup is not None:
        payload["reply_markup"] = reply_markup
    response = httpx.post(_api_url("editMessageText"), json=payload)
    try:
        response.raise_for_status()
    except httpx.HTTPStatusError as e:
        raise RuntimeError(f"Telegram API error {e.response.status_code}") from None


def answer_callback_query(callback_query_id: str, text: str | None = None) -> None:
    payload: dict = {"callback_query_id": callback_query_id}
    if text is not None:
        payload["text"] = text
    response = httpx.post(_api_url("answerCallbackQuery"), json=payload)
    try:
        response.raise_for_status()
    except httpx.HTTPStatusError as e:
        raise RuntimeError(f"Telegram API error {e.response.status_code}") from None
