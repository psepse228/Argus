def test_verify_webhook_signature_correct(monkeypatch):
    monkeypatch.setenv("TELEGRAM_WEBHOOK_SECRET", "s3cr3t")
    from app.telegram.bot_client import verify_webhook_signature
    assert verify_webhook_signature("s3cr3t") is True


def test_verify_webhook_signature_wrong(monkeypatch):
    monkeypatch.setenv("TELEGRAM_WEBHOOK_SECRET", "s3cr3t")
    from app.telegram.bot_client import verify_webhook_signature
    assert verify_webhook_signature("wrong") is False


def test_verify_webhook_signature_missing_header(monkeypatch):
    monkeypatch.setenv("TELEGRAM_WEBHOOK_SECRET", "s3cr3t")
    from app.telegram.bot_client import verify_webhook_signature
    assert verify_webhook_signature(None) is False


def test_verify_webhook_signature_no_secret_configured(monkeypatch):
    monkeypatch.delenv("TELEGRAM_WEBHOOK_SECRET", raising=False)
    from app.telegram.bot_client import verify_webhook_signature
    assert verify_webhook_signature("anything") is False


def test_send_message_wraps_connect_error(monkeypatch):
    import httpx
    import pytest

    def fake_post(url, json, timeout):
        raise httpx.ConnectError("boom")

    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "123:ABC")
    import app.telegram.bot_client as bot_client
    monkeypatch.setattr(bot_client.httpx, "post", fake_post)

    with pytest.raises(bot_client.TelegramSendError):
        bot_client.send_message("conn123", 999, "Hello")


def test_send_message_calls_correct_endpoint(monkeypatch):
    captured = {}

    class FakeResponse:
        def raise_for_status(self):
            pass

        def json(self):
            return {"ok": True}

    def fake_post(url, json, timeout):
        captured["url"] = url
        captured["json"] = json
        return FakeResponse()

    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "123:ABC")
    import app.telegram.bot_client as bot_client
    monkeypatch.setattr(bot_client.httpx, "post", fake_post)

    result = bot_client.send_message("conn123", 999, "Hello")

    assert captured["url"] == "https://api.telegram.org/bot123:ABC/sendMessage"
    assert captured["json"] == {"business_connection_id": "conn123", "chat_id": 999, "text": "Hello"}
    assert result == {"ok": True}


def test_send_bot_message_calls_correct_endpoint_without_business_connection(monkeypatch):
    captured = {}

    class FakeResponse:
        def raise_for_status(self):
            pass

        def json(self):
            return {"ok": True}

    def fake_post(url, json, timeout):
        captured["url"] = url
        captured["json"] = json
        return FakeResponse()

    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "123:ABC")
    import app.telegram.bot_client as bot_client
    monkeypatch.setattr(bot_client.httpx, "post", fake_post)

    result = bot_client.send_bot_message(555, "Привет")

    assert captured["url"] == "https://api.telegram.org/bot123:ABC/sendMessage"
    # No business_connection_id key at all -- this is the bot's own identity,
    # not a relay through a connected business account.
    assert captured["json"] == {"chat_id": 555, "text": "Привет"}
    assert result == {"ok": True}


def test_send_bot_message_wraps_connect_error(monkeypatch):
    import httpx
    import pytest

    def fake_post(url, json, timeout):
        raise httpx.ConnectError("boom")

    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "123:ABC")
    import app.telegram.bot_client as bot_client
    monkeypatch.setattr(bot_client.httpx, "post", fake_post)

    with pytest.raises(bot_client.TelegramSendError):
        bot_client.send_bot_message(555, "Привет")
