import logging
import os
import tempfile
from typing import Optional

from faster_whisper import WhisperModel

logger = logging.getLogger(__name__)

_model: Optional[WhisperModel] = None


def _get_model() -> WhisperModel:
    global _model
    if _model is None:
        logger.info("loading faster-whisper model (medium, int8) — this may take a while on first run")
        _model = WhisperModel("medium", compute_type="int8")
    return _model


def transcribe_audio(audio_bytes: bytes, filename: str) -> str:
    suffix = os.path.splitext(filename)[1] or ".webm"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(audio_bytes)
        tmp_path = tmp.name

    try:
        segments, _info = _get_model().transcribe(tmp_path, language="uk")
        return "".join(segment.text for segment in segments).strip()
    finally:
        os.remove(tmp_path)
