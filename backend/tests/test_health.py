from app.config import Settings


def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok", "api_version": "1", "ai": "down"}


def test_unknown_path_uses_error_format(client):
    r = client.get("/nope")
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "not_found"


def test_cors_preflight_allows_simulator(client):
    r = client.options(
        "/api/v1/runs",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )
    assert r.headers["access-control-allow-origin"] == "http://localhost:5173"


def test_settings_read_the_environment(monkeypatch):
    monkeypatch.setenv("ALLOWED_ORIGINS", "http://a.test, http://b.test")
    monkeypatch.setenv("WS_DRAIN_S", "0.25")
    s = Settings.from_env()
    assert s.allowed_origins == ["http://a.test", "http://b.test"]
    assert s.ws_drain_s == 0.25
