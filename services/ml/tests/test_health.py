"""Tests for the health check endpoint."""

from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.config import Settings
from app.main import app


def _make_settings(tmp_path: Path) -> Settings:
    """Create settings pointing to a temporary directory."""
    return Settings(
        hf_home=tmp_path / "models",
        asr_default_language="English",
    )


def test_health_returns_200(tmp_path: Path) -> None:
    with patch("app.main.get_settings", return_value=_make_settings(tmp_path)):
        client = TestClient(app)
        response = client.get("/health")
    assert response.status_code == 200


def test_health_degraded_when_no_models(tmp_path: Path) -> None:
    with patch("app.main.get_settings", return_value=_make_settings(tmp_path)):
        client = TestClient(app)
        data = client.get("/health").json()
    assert data["status"] == "degraded"
    ml_models = [m for m in data["models"] if m["name"] != "nisqa-v2.0"]
    for model in ml_models:
        assert model["available"] is False


def test_health_ok_when_models_present(tmp_path: Path) -> None:
    settings = _make_settings(tmp_path)
    models_dir = settings.hf_home
    models_dir.mkdir(parents=True)

    for dir_name in [
        "Qwen3-ASR-1.7B-bf16",
        "Qwen3-ForcedAligner-0.6B-bf16",
        "Qwen3-TTS-12Hz-1.7B-Base-bf16",
    ]:
        model_dir = models_dir / dir_name
        model_dir.mkdir()
        (model_dir / "model.safetensors").write_bytes(b"fake-weights")

    with patch("app.main.get_settings", return_value=settings):
        client = TestClient(app)
        data = client.get("/health").json()

    ml_models = [m for m in data["models"] if m["name"] != "nisqa-v2.0"]
    for model in ml_models:
        assert model["available"] is True
        assert model["size_bytes"] is not None
        assert model["size_bytes"] > 0


def test_health_response_schema(tmp_path: Path) -> None:
    with patch("app.main.get_settings", return_value=_make_settings(tmp_path)):
        client = TestClient(app)
        data = client.get("/health").json()
    assert "status" in data
    assert "models" in data
    assert "models_dir" in data
    assert isinstance(data["models"], list)
    assert len(data["models"]) == 4
    for model in data["models"]:
        assert "name" in model
        assert "available" in model
        assert "path" in model
