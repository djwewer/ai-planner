import os
from unittest.mock import MagicMock

from app.ai import whisper


def _mock_model(text_segments):
    segments = [MagicMock(text=t) for t in text_segments]
    model = MagicMock()
    model.transcribe.return_value = (segments, MagicMock())
    return model


def test_transcribe_audio_returns_joined_text(monkeypatch):
    mock_model = _mock_model(["Купити молоко", " і подзвонити"])
    monkeypatch.setattr(whisper, "_get_model", lambda: mock_model)

    result = whisper.transcribe_audio(b"fake-audio-bytes", "recording.webm")

    assert result == "Купити молоко і подзвонити"
    assert mock_model.transcribe.call_args.kwargs["language"] == "uk"


def test_transcribe_audio_cleans_up_temp_file(monkeypatch):
    mock_model = _mock_model(["test"])
    created_paths = []

    def _capture_path(path, **kwargs):
        created_paths.append(path)
        assert os.path.exists(path)
        return mock_model.transcribe.return_value

    mock_model.transcribe.side_effect = _capture_path
    monkeypatch.setattr(whisper, "_get_model", lambda: mock_model)

    whisper.transcribe_audio(b"fake-audio-bytes", "recording.webm")

    assert len(created_paths) == 1
    assert not os.path.exists(created_paths[0])
