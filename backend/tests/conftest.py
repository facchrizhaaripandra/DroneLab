import threading
import time

import httpx
import pytest
import uvicorn
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


@pytest.fixture
def settings(tmp_path) -> Settings:
    return Settings(db_path=str(tmp_path / "test.db"))


@pytest.fixture
def client(settings):
    def refuse(request):  # no AI service or planner, whatever runs on this machine
        raise httpx.ConnectError("refused", request=request)

    transport = httpx.MockTransport(refuse)
    app = create_app(settings, ai_transport=transport, planner_transport=transport)
    with TestClient(app) as c:
        yield c


@pytest.fixture
def live_server(settings):
    """A real gateway on a free local port, for tools that talk over the network."""
    config = uvicorn.Config(create_app(settings), host="127.0.0.1", port=0, log_level="warning")
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    deadline = time.monotonic() + 10
    while not server.started:
        assert thread.is_alive() and time.monotonic() < deadline, "the gateway did not start"
        time.sleep(0.01)
    port = server.servers[0].sockets[0].getsockname()[1]
    yield f"http://127.0.0.1:{port}"
    server.should_exit = True
    thread.join(timeout=10)
