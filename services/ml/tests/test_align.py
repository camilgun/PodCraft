"""Tests for POST /align."""

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
from app.models.aligner_model import (
    AlignerLoadError,
    get_aligner_model,
    reset_aligner_model_cache,
)


def _make_settings(tmp_path: Path) -> Settings:
    """Create settings pointing to a temporary models directory."""
    return Settings(
        hf_home=tmp_path / "models",
        asr_default_language="English",
    )


@dataclass
class _FakeAlignItem:
    text: str
    start_time: float
    end_time: float


@dataclass
class _FakeAlignResult:
    items: list[_FakeAlignItem]


class _FakeAlignModel:
    def __init__(self) -> None:
        self.calls: list[dict[str, object]] = []

    def generate(self, _audio_path: str, *, text: str, language: str) -> _FakeAlignResult:
        self.calls.append({"text": text, "language": language})
        return _FakeAlignResult(
            items=[
                _FakeAlignItem(text="ciao", start_time=0.1, end_time=0.4),
                _FakeAlignItem(text="mondo", start_time=0.5, end_time=0.9),
            ]
        )


class _FakeMemorySampler:
    def __init__(self, *, sample_interval_seconds: float) -> None:
        self.sample_interval_seconds = sample_interval_seconds
        self.peak_memory_gb = 2.1
        self.delta_memory_gb = 0.3

    async def __aenter__(self) -> _FakeMemorySampler:
        return self

    async def __aexit__(self, exc_type: object, exc: object, tb: object) -> None:
        return None


def test_align_returns_200_with_expected_schema(tmp_path: Path) -> None:
    settings = _make_settings(tmp_path)
    fake_model = _FakeAlignModel()

    with (
        patch("app.routers.align.get_settings", return_value=settings),
        patch("app.routers.align.probe_audio_duration_seconds", return_value=60.0),
        patch("app.routers.align.normalize_audio_for_asr"),
        patch("app.routers.align.get_aligner_model", return_value=fake_model),
    ):
        client = TestClient(app)
        response = client.post(
            "/align",
            files={"file": ("sample.m4a", b"fake-audio", "audio/mp4")},
            data={"text": "ciao mondo"},
        )

    assert response.status_code == 200
    data = response.json()
    assert data["model_used"] == settings.aligner_model_id
    assert isinstance(data["inference_time_seconds"], float)
    assert len(data["words"]) == 2
    assert data["words"][0]["word"] == "ciao"
    assert data["words"][0]["start_time"] == 0.1
    assert data["words"][0]["end_time"] == 0.4
    assert fake_model.calls[0]["text"] == "ciao mondo"
    assert fake_model.calls[0]["language"] == "English"


def test_align_uses_explicit_language_hint(tmp_path: Path) -> None:
    settings = _make_settings(tmp_path)
    fake_model = _FakeAlignModel()

    with (
        patch("app.routers.align.get_settings", return_value=settings),
        patch("app.routers.align.probe_audio_duration_seconds", return_value=60.0),
        patch("app.routers.align.normalize_audio_for_asr"),
        patch("app.routers.align.get_aligner_model", return_value=fake_model),
    ):
        client = TestClient(app)
        response = client.post(
            "/align",
            files={"file": ("sample.m4a", b"fake-audio", "audio/mp4")},
            data={"text": "ciao mondo", "language": "it"},
        )

    assert response.status_code == 200
    assert fake_model.calls[0]["language"] == "Italian"


def test_align_uses_config_default_language_when_missing(tmp_path: Path) -> None:
    settings = Settings(
        hf_home=tmp_path / "models",
        asr_default_language="Italian",
    )
    fake_model = _FakeAlignModel()

    with (
        patch("app.routers.align.get_settings", return_value=settings),
        patch("app.routers.align.probe_audio_duration_seconds", return_value=60.0),
        patch("app.routers.align.normalize_audio_for_asr"),
        patch("app.routers.align.get_aligner_model", return_value=fake_model),
    ):
        client = TestClient(app)
        response = client.post(
            "/align",
            files={"file": ("sample.m4a", b"fake-audio", "audio/mp4")},
            data={"text": "ciao mondo"},
        )

    assert response.status_code == 200
    assert fake_model.calls[0]["language"] == "Italian"


def test_align_returns_400_for_empty_text(tmp_path: Path) -> None:
    settings = _make_settings(tmp_path)

    with (
        patch("app.routers.align.get_settings", return_value=settings),
        patch("app.routers.align.get_aligner_model") as get_model,
    ):
        client = TestClient(app)
        response = client.post(
            "/align",
            files={"file": ("sample.m4a", b"fake-audio", "audio/mp4")},
            data={"text": "   "},
        )

    assert response.status_code == 400
    assert response.json()["detail"] == "Field 'text' must be a non-empty string"
    get_model.assert_not_called()


def test_align_returns_400_for_empty_file(tmp_path: Path) -> None:
    settings = _make_settings(tmp_path)

    with patch("app.routers.align.get_settings", return_value=settings):
        client = TestClient(app)
        response = client.post(
            "/align",
            files={"file": ("sample.m4a", b"", "audio/mp4")},
            data={"text": "ciao mondo"},
        )

    assert response.status_code == 400
    assert response.json()["detail"] == "Uploaded file is empty"


def test_align_returns_400_for_invalid_audio(tmp_path: Path) -> None:
    settings = _make_settings(tmp_path)

    with (
        patch("app.routers.align.get_settings", return_value=settings),
        patch(
            "app.routers.align.probe_audio_duration_seconds",
            side_effect=AudioInputError("invalid audio"),
        ),
    ):
        client = TestClient(app)
        response = client.post(
            "/align",
            files={"file": ("sample.m4a", b"fake-audio", "audio/mp4")},
            data={"text": "ciao mondo"},
        )

    assert response.status_code == 400
    assert response.json()["detail"] == "invalid audio"


def test_align_returns_503_for_audio_infrastructure_error(tmp_path: Path) -> None:
    settings = _make_settings(tmp_path)

    with (
        patch("app.routers.align.get_settings", return_value=settings),
        patch(
            "app.routers.align.probe_audio_duration_seconds",
            side_effect=AudioInfrastructureError("Required binary not found: ffprobe"),
        ),
    ):
        client = TestClient(app)
        response = client.post(
            "/align",
            files={"file": ("sample.m4a", b"fake-audio", "audio/mp4")},
            data={"text": "ciao mondo"},
        )

    assert response.status_code == 503
    assert response.json()["detail"] == "Required binary not found: ffprobe"


def test_align_returns_400_for_unsupported_language_hint(tmp_path: Path) -> None:
    settings = _make_settings(tmp_path)

    with (
        patch("app.routers.align.get_settings", return_value=settings),
        patch("app.routers.align.get_aligner_model") as get_model,
    ):
        client = TestClient(app)
        response = client.post(
            "/align",
            files={"file": ("sample.m4a", b"fake-audio", "audio/mp4")},
            data={"text": "ciao mondo", "language": "Klingon"},
        )

    assert response.status_code == 400
    assert response.json()["detail"] == "Unsupported language hint: Klingon"
    get_model.assert_not_called()


def test_align_returns_503_when_model_loading_fails(tmp_path: Path) -> None:
    settings = _make_settings(tmp_path)

    with (
        patch("app.routers.align.get_settings", return_value=settings),
        patch("app.routers.align.probe_audio_duration_seconds", return_value=5.0),
        patch("app.routers.align.normalize_audio_for_asr"),
        patch(
            "app.routers.align.get_aligner_model",
            side_effect=AlignerLoadError("model unavailable"),
        ),
    ):
        client = TestClient(app)
        response = client.post(
            "/align",
            files={"file": ("sample.m4a", b"fake-audio", "audio/mp4")},
            data={"text": "ciao mondo"},
        )

    assert response.status_code == 503
    assert response.json()["detail"] == "model unavailable"


def test_align_logs_memory_metrics_on_success(tmp_path: Path) -> None:
    settings = _make_settings(tmp_path)
    fake_model = _FakeAlignModel()

    with (
        patch("app.routers.align.get_settings", return_value=settings),
        patch("app.routers.align.probe_audio_duration_seconds", return_value=60.0),
        patch("app.routers.align.normalize_audio_for_asr"),
        patch("app.routers.align.get_aligner_model", return_value=fake_model),
        patch("app.routers.align.MemorySampler", _FakeMemorySampler),
        patch("app.routers.align._log_align_status") as log_status,
    ):
        client = TestClient(app)
        response = client.post(
            "/align",
            files={"file": ("sample.m4a", b"fake-audio", "audio/mp4")},
            data={"text": "ciao mondo"},
        )

    assert response.status_code == 200
    assert log_status.call_count == 1
    call_kwargs = log_status.call_args.kwargs
    assert call_kwargs["peak_memory_gb"] == 2.1
    assert call_kwargs["delta_memory_gb"] == 0.3
    assert call_kwargs["word_count"] == 2


def test_aligner_model_is_cached_after_first_load(tmp_path: Path) -> None:
    settings = _make_settings(tmp_path)
    aligner_model_path = settings.hf_home / "Qwen3-ForcedAligner-0.6B-bf16"
    aligner_model_path.mkdir(parents=True)

    reset_aligner_model_cache()
    try:
        with patch(
            "app.models.aligner_model._load_model",
            return_value=_FakeAlignModel(),
        ) as load:
            first = get_aligner_model(settings)
            second = get_aligner_model(settings)

        assert first is second
        assert load.call_count == 1
    finally:
        reset_aligner_model_cache()


def test_align_cleans_temp_dir_on_error(tmp_path: Path) -> None:
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
        patch("app.routers.align.get_settings", return_value=settings),
        patch(
            "app.routers.align.tempfile.TemporaryDirectory",
            _TrackingTemporaryDirectory,
        ),
        patch(
            "app.routers.align.probe_audio_duration_seconds",
            side_effect=AudioInputError("bad audio"),
        ),
    ):
        client = TestClient(app)
        response = client.post(
            "/align",
            files={"file": ("sample.m4a", b"fake-audio", "audio/mp4")},
            data={"text": "ciao mondo"},
        )

    assert response.status_code == 400
    assert len(created_dirs) == 1
    tracked = created_dirs[0]
    assert tracked.cleaned is True
    assert not Path(tracked.name).exists()
