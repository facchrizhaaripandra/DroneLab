"""WS /ws/v1/runs/{run_id}: telemetry in; a low battery hint (and acks, if asked) out."""

from fastapi import APIRouter, WebSocket
from pydantic import ValidationError
from starlette.websockets import WebSocketDisconnect

from app.models.contract import TelemetryFrame

router = APIRouter()

POLICY_VIOLATION = 1008
LOW_BATTERY = 20


@router.websocket("/ws/v1/runs/{run_id}")
async def telemetry(socket: WebSocket, run_id: str):
    state = socket.app.state
    origin = socket.headers.get("origin")  # browsers always send it, tools usually do not
    if origin and origin not in state.settings.allowed_origins:
        await socket.close(code=POLICY_VIOLATION)
        return
    finished = state.repo.run_status(run_id)
    if finished is None:
        await socket.close(code=POLICY_VIOLATION)
        return
    hub = state.hub
    if finished:
        hub.seal(run_id)
    acks = socket.query_params.get("ack") == "1"  # used by the latency experiment
    hinted = False
    await socket.accept()
    hub.opened(run_id)
    try:
        while True:
            message = await socket.receive()
            if message["type"] == "websocket.disconnect":
                break
            try:
                frame = TelemetryFrame.model_validate_json(message.get("text") or "")
            except ValidationError:
                continue  # a broken frame is ignored, the connection stays open
            if not hub.ingest(run_id, {**frame.model_dump(), "type": "sample"}):
                continue
            if not hinted and frame.battery <= LOW_BATTERY:
                hinted = True
                await socket.send_json({"type": "hint", "text": "Baterai rendah"})
            if acks:
                await socket.send_json({"type": "ack", "t_ms": frame.t_ms})
    except (WebSocketDisconnect, RuntimeError):
        pass  # the client went away while we were sending
    finally:
        hub.closed(run_id)
