import logging

from fastapi import APIRouter, Depends, HTTPException, UploadFile, status

from app.ai.whisper import transcribe_audio
from app.models import User
from app.security import get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/transcribe", tags=["transcription"])


@router.post("")
async def transcribe(
    file: UploadFile,
    current_user: User = Depends(get_current_user),
):
    audio_bytes = await file.read()
    try:
        text = transcribe_audio(audio_bytes, file.filename or "recording.webm")
    except Exception:
        logger.exception("transcription failed for user_id=%s", current_user.id)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Не вдалося розпізнати мову, спробуйте ще раз",
        )
    return {"text": text}
