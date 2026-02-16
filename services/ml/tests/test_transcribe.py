"""Tests for POST /transcribe."""

from __future__ import annotations

import shutil
import tempfile
from dataclasses import dataclass
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.config import Settings
from app.lib.audio import AudioInfrastructureError, AudioInputError
from app.main import app
from app.models.asr_model import ModelLoadError, get_asr_model, reset_asr_model_cache


def _make_settings(tmp_path: Path) -> Settings:
    """Create settings pointing to a temporary models directory."""
    return Settings(
        hf_home=tmp_path / "models",
        asr_default_language="English",
    )


@dataclass
class _FakeOutput:
    text: str
    language: str | None = None


class _FakeModel:
    def __init__(self, output_language: str | None = "it") -> None:
        self.calls: list[dict[str, object]] = []
        self.output_language = output_language

    def generate(self, _audio_path: str, *, verbose: bool = False, **kwargs: object) -> _FakeOutput:
        self.calls.append({"verbose": verbose, **kwargs})
        _ = verbose
        return _FakeOutput(text="ciao dal test", language=self.output_language)


class _FakeMemorySampler:
    def __init__(self, *, sample_interval_seconds: float) -> None:
        self.sample_interval_seconds = sample_interval_seconds
        self.peak_memory_gb = 3.5
        self.delta_memory_gb = 0.2

    async def __aenter__(self) -> _FakeMemorySampler:
        return self

    async def __aexit__(self, exc_type: object, exc: object, tb: object) -> None:
        return None


def test_transcribe_returns_200_with_expected_schema(tmp_path: Path) -> None:
    settings = _make_settings(tmp_path)
    fake_model = _FakeModel()

    with (
        patch("app.routers.asr.get_settings", return_value=settings),
        patch("app.routers.asr.probe_audio_duration_seconds", return_value=60.0),
        patch("app.routers.asr.normalize_audio_for_asr"),
        patch("app.routers.asr.get_asr_model", return_value=fake_model),
    ):
        client = TestClient(app)
        response = client.post(
            "/transcribe",
            files={"file": ("sample.m4a", b"fake-audio", "audio/mp4")},
        )

    assert response.status_code == 200
    data = response.json()
    assert data["text"] == "ciao dal test"
    assert data["language"] == "it"
    assert isinstance(data["inference_time_seconds"], float)
    assert data["audio_duration_seconds"] == 60.0
    assert data["model_used"] == settings.asr_model_id
    assert fake_model.calls[0]["language"] == "English"


def test_transcribe_uses_explicit_language_hint(tmp_path: Path) -> None:
    settings = _make_settings(tmp_path)
    fake_model = _FakeModel(output_language=None)

    with (
        patch("app.routers.asr.get_settings", return_value=settings),
        patch("app.routers.asr.probe_audio_duration_seconds", return_value=60.0),
        patch("app.routers.asr.normalize_audio_for_asr"),
        patch("app.routers.asr.get_asr_model", return_value=fake_model),
    ):
        client = TestClient(app)
        response = client.post(
            "/transcribe",
            files={"file": ("sample.m4a", b"fake-audio", "audio/mp4")},
            data={"language": "it"},
        )

    assert response.status_code == 200
    assert response.json()["language"] == "it"
    assert fake_model.calls[0]["language"] == "Italian"


def test_transcribe_logs_memory_metrics_on_success(tmp_path: Path) -> None:
    settings = _make_settings(tmp_path)
    fake_model = _FakeModel()

    with (
        patch("app.routers.asr.get_settings", return_value=settings),
        patch("app.routers.asr.probe_audio_duration_seconds", return_value=60.0),
        patch("app.routers.asr.normalize_audio_for_asr"),
        patch("app.routers.asr.get_asr_model", return_value=fake_model),
        patch("app.routers.asr.MemorySampler", _FakeMemorySampler),
        patch("app.routers.asr._log_transcribe_status") as log_status,
    ):
        client = TestClient(app)
        response = client.post(
            "/transcribe",
            files={"file": ("sample.m4a", b"fake-audio", "audio/mp4")},
        )

    assert response.status_code == 200
    assert log_status.call_count == 1
    call_kwargs = log_status.call_args.kwargs
    assert call_kwargs["peak_memory_gb"] == 3.5
    assert call_kwargs["delta_memory_gb"] == 0.2


def test_transcribe_uses_config_default_language_when_missing(tmp_path: Path) -> None:
    settings = Settings(
        hf_home=tmp_path / "models",
        asr_default_language="English",
    )
    fake_model = _FakeModel(output_language=None)

    with (
        patch("app.routers.asr.get_settings", return_value=settings),
        patch("app.routers.asr.probe_audio_duration_seconds", return_value=60.0),
        patch("app.routers.asr.normalize_audio_for_asr"),
        patch("app.routers.asr.get_asr_model", return_value=fake_model),
    ):
        client = TestClient(app)
        response = client.post(
            "/transcribe",
            files={"file": ("sample.m4a", b"fake-audio", "audio/mp4")},
        )

    assert response.status_code == 200
    assert response.json()["language"] == "en"
    assert fake_model.calls[0]["language"] == "English"


def test_transcribe_normalizes_detected_language_name_to_code(tmp_path: Path) -> None:
    settings = _make_settings(tmp_path)
    fake_model = _FakeModel(output_language="Italian")

    with (
        patch("app.routers.asr.get_settings", return_value=settings),
        patch("app.routers.asr.probe_audio_duration_seconds", return_value=60.0),
        patch("app.routers.asr.normalize_audio_for_asr"),
        patch("app.routers.asr.get_asr_model", return_value=fake_model),
    ):
        client = TestClient(app)
        response = client.post(
            "/transcribe",
            files={"file": ("sample.m4a", b"fake-audio", "audio/mp4")},
        )

    assert response.status_code == 200
    assert response.json()["language"] == "it"


def test_transcribe_returns_default_language_without_detection(
    tmp_path: Path,
) -> None:
    settings = _make_settings(tmp_path)
    fake_model = _FakeModel(output_language=None)

    with (
        patch("app.routers.asr.get_settings", return_value=settings),
        patch("app.routers.asr.probe_audio_duration_seconds", return_value=60.0),
        patch("app.routers.asr.normalize_audio_for_asr"),
        patch("app.routers.asr.get_asr_model", return_value=fake_model),
    ):
        client = TestClient(app)
        response = client.post(
            "/transcribe",
            files={"file": ("sample.m4a", b"fake-audio", "audio/mp4")},
        )

    assert response.status_code == 200
    assert response.json()["language"] == "en"


def test_transcribe_returns_400_for_invalid_audio(tmp_path: Path) -> None:
    settings = _make_settings(tmp_path)
    with (
        patch("app.routers.asr.get_settings", return_value=settings),
        patch(
            "app.routers.asr.probe_audio_duration_seconds",
            side_effect=AudioInputError("invalid audio"),
        ),
    ):
        client = TestClient(app)
        response = client.post(
            "/transcribe",
            files={"file": ("sample.m4a", b"fake-audio", "audio/mp4")},
        )

    assert response.status_code == 400
    assert response.json()["detail"] == "invalid audio"


def test_transcribe_returns_503_for_audio_infrastructure_error(tmp_path: Path) -> None:
    settings = _make_settings(tmp_path)
    with (
        patch("app.routers.asr.get_settings", return_value=settings),
        patch(
            "app.routers.asr.probe_audio_duration_seconds",
            side_effect=AudioInfrastructureError("Required binary not found: ffprobe"),
        ),
    ):
        client = TestClient(app)
        response = client.post(
            "/transcribe",
            files={"file": ("sample.m4a", b"fake-audio", "audio/mp4")},
        )

    assert response.status_code == 503
    assert response.json()["detail"] == "Required binary not found: ffprobe"


def test_transcribe_returns_400_for_unsupported_language_hint(tmp_path: Path) -> None:
    settings = _make_settings(tmp_path)

    with (
        patch("app.routers.asr.get_settings", return_value=settings),
        patch("app.routers.asr.get_asr_model") as get_model,
    ):
        client = TestClient(app)
        response = client.post(
            "/transcribe",
            files={"file": ("sample.m4a", b"fake-audio", "audio/mp4")},
            data={"language": "Klingon"},
        )

    assert response.status_code == 400
    assert response.json()["detail"] == "Unsupported language hint: Klingon"
    get_model.assert_not_called()


def test_transcribe_returns_503_when_model_loading_fails(tmp_path: Path) -> None:
    settings = _make_settings(tmp_path)

    with (
        patch("app.routers.asr.get_settings", return_value=settings),
        patch("app.routers.asr.probe_audio_duration_seconds", return_value=5.0),
        patch("app.routers.asr.normalize_audio_for_asr"),
        patch(
            "app.routers.asr.get_asr_model",
            side_effect=ModelLoadError("model unavailable"),
        ),
    ):
        client = TestClient(app)
        response = client.post(
            "/transcribe",
            files={"file": ("sample.m4a", b"fake-audio", "audio/mp4")},
        )

    assert response.status_code == 503
    assert response.json()["detail"] == "model unavailable"


def test_asr_model_is_cached_after_first_load(tmp_path: Path) -> None:
    settings = _make_settings(tmp_path)
    asr_model_path = settings.hf_home / "Qwen3-ASR-1.7B-bf16"
    asr_model_path.mkdir(parents=True)

    reset_asr_model_cache()
    try:
        with patch("app.models.asr_model._load_model", return_value=_FakeModel()) as load:
            first = get_asr_model(settings)
            second = get_asr_model(settings)

        assert first is second
        assert load.call_count == 1
    finally:
        reset_asr_model_cache()


def test_transcribe_cleans_temp_dir_on_error(tmp_path: Path) -> None:
    settings = _make_settings(tmp_path)
    created_dirs: list[_TrackingTemporaryDirectory] = []

    class _TrackingTemporaryDirectory:
        def __init__(self, *, prefix: str) -> None:
            self.name = tempfile.mkdtemp(prefix=prefix)
            self.cleaned = False
            created_dirs.append(self)

        def cleanup(self) -> None:
            self.cleaned = True
            shutil.rmtree(self.name, ignore_errors=True)

    with (
        patch("app.routers.asr.get_settings", return_value=settings),
        patch(
            "app.routers.asr.tempfile.TemporaryDirectory",
            _TrackingTemporaryDirectory,
        ),
        patch(
            "app.routers.asr.probe_audio_duration_seconds",
            side_effect=AudioInputError("bad audio"),
        ),
    ):
        client = TestClient(app)
        response = client.post(
            "/transcribe",
            files={"file": ("sample.m4a", b"fake-audio", "audio/mp4")},
        )

    assert response.status_code == 400
    assert len(created_dirs) == 1
    tracked = created_dirs[0]
    assert tracked.cleaned is True
    assert not Path(tracked.name).exists()
