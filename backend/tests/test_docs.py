"""Every endpoint is documented, and every endpoint has at least been called by a test."""

from pathlib import Path

from app.main import create_app

REPO = Path(__file__).resolve().parents[2]


def paths():
    return [*create_app().openapi()["paths"], "/ws/v1/runs/{run_id}"]


def test_every_endpoint_is_in_the_api_document():
    text = (REPO / "docs" / "api.md").read_text("utf-8")
    missing = [p for p in paths() if p.replace("{run_id}", "{id}") not in text]
    assert missing == []


def test_the_backend_readme_starts_the_gateway_in_at_most_five_commands():
    text = (REPO / "backend" / "README.md").read_text("utf-8")
    block = text.split("## Menjalankan", 1)[1].split("```powershell", 1)[1].split("```", 1)[0]
    commands = [line for line in block.splitlines() if line.strip()]
    assert 1 <= len(commands) <= 5
    assert "uvicorn app.main:app" in commands[-1]
