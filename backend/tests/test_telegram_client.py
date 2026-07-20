from unittest.mock import MagicMock

from app.telegram import client as telegram_client


def _mock_response(json_data, status_code=200):
    response = MagicMock()
    response.status_code = status_code
    response.json.return_value = json_data
    response.raise_for_status = MagicMock()
    return response


def test_send_message_returns_result(monkeypatch):
    mock_post = MagicMock(return_value=_mock_response({"ok": True, "result": {"message_id": 1}}))
    monkeypatch.setattr(telegram_client.httpx, "post", mock_post)

    result = telegram_client.send_message(123, "hello")

    assert result == {"message_id": 1}
    assert mock_post.call_args.args[0].endswith("/sendMessage")


def test_edit_message_sends_expected_payload(monkeypatch):
    mock_post = MagicMock(return_value=_mock_response({"ok": True, "result": {}}))
    monkeypatch.setattr(telegram_client.httpx, "post", mock_post)

    telegram_client.edit_message(123, 456, "updated", reply_markup={"inline_keyboard": []})

    payload = mock_post.call_args.kwargs["json"]
    assert payload == {
        "chat_id": 123,
        "message_id": 456,
        "text": "updated",
        "reply_markup": {"inline_keyboard": []},
    }


def test_answer_callback_query_sends_id_and_text(monkeypatch):
    mock_post = MagicMock(return_value=_mock_response({"ok": True, "result": True}))
    monkeypatch.setattr(telegram_client.httpx, "post", mock_post)

    telegram_client.answer_callback_query("cbq-1", text="done")

    payload = mock_post.call_args.kwargs["json"]
    assert payload == {"callback_query_id": "cbq-1", "text": "done"}
