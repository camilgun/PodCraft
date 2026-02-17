"""Tests for POST /synthesize."""

from __future__ import annotations

import json
import shutil
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from unittest.mock import patch

import numpy as np
from fastapi.testclient import TestClient

from app.config import Settings
from app.lib.audio import AudioInfrastructureError, AudioInputError
from app.main import app
from app.models.tts_model import TTSLoadError, get_tts_model, reset_tts_model_cache
from app.routers import asr as asr_router
from app.routers import tts as tts_router


def _make_settings(tmp_path: Path) -> Settings:
    """Create settings pointing to a temporary models directory."""
    return Settings(
        hf_home=tmp_path / "models",
        asr_default_language="English",
    )


@dataclass
class _FakeGenerationResult:
    audio: object
    samples: int
    sample_rate: int
    segment_idx: int = 0
    token_count: int = 100
    audio_duration: str = "1.0s"
    real_time_factor: float = 0.5
    processing_time_seconds: float = 1.0
    peak_memory_usage: float = 5.0
    prompt: dict[str, object] = field(default_factory=dict)
    audio_samples: dict[str, object] = field(default_factory=dict)


class _FakeTTSModel:
    def __init__(self, sample_rate: int = 12000) -> None:
        self.calls: list[dict[str, object]] = []
        self._sample_rate = sample_rate

    @property
    def sample_rate(self) -> int:
        return self._sample_rate

    def generate(
        self,
        text: str,
        ref_audio: str | None = None,
        ref_text: str | None = None,
        lang_code: str = "auto",
        verbose: bool = False,
        **kwargs: object,
    ):
        self.calls.append(
            {
                "text": text,
                "ref_audio": ref_audio,
                "ref_text": ref_text,
                "lang_code": lang_code,
            }
        )
        _ = verbose
        audio = np.sin(
            np.linspace(0, 440 * 2 * np.pi, self._sample_rate, dtype=np.float32)
        )
        yield _FakeGenerationResult(
            audio=audio,
            samples=len(audio),
            sample_rate=self._sample_rate,
        )


class _FakeMemorySampler:
    def __init__(self, *, sample_interval_seconds: float) -> None:
        self.sample_interval_seconds = sample_interval_seconds
        self.peak_memory_gb = 5.2
        self.delta_memory_gb = 1.5

    async def __aenter__(self) -> _FakeMemorySampler:
        return self

    async def __aexit__(self, exc_type: object, exc: object, tb: object) -> None:
        return None


class _TrackingAsyncSemaphore:
    def __init__(self) -> None:
        self.enter_count = 0

    async def __aenter__(self) -> _TrackingAsyncSemaphore:
        self.enter_count += 1
        return self

    async def __aexit__(self, exc_type: object, exc: object, tb: object) -> None:
        return None


_COMMON_PATCHES = (
    "app.routers.tts.probe_audio_duration_seconds",
    "app.routers.tts.normalize_audio_for_tts_reference",
    "app.routers.tts.get_tts_model",
)


_SENTINEL = object()


def _post_synthesize(
    client: TestClient,
    *,
    text: str = "Ciao, questa e una frase di test.",
    reference_text: str | object = "Testo di riferimento parlato nel clip.",
    language: str | None = None,
    audio_content: bytes = b"fake-audio",
) -> object:
    data: dict[str, str] = {"text": text}
    if reference_text is not _SENTINEL:
        data["reference_text"] = str(reference_text)
    if language is not None:
        data["language"] = language
    return client.post(
        "/synthesize",
        files={"reference_audio": ("ref.wav", audio_content, "audio/wav")},
        data=data,
    )


@dataclass
class _FakeASROutput:
    text: str
    language: str | None = None


class _FakeASRModel:
    def generate(
        self, _audio_path: str, *, verbose: bool = False, **kwargs: object
    ) -> _FakeASROutput:
        _ = verbose
        return _FakeASROutput(text="trascrizione automatica del clip")


# ── Happy-path tests ────────────────────────────────────────────────


def test_synthesize_returns_200_with_wav_audio(tmp_path: Path) -> None:
    settings = _make_settings(tmp_path)
    fake_model = _FakeTTSModel()

    with (
        patch("app.routers.tts.get_settings", return_value=settings),
        patch("app.routers.tts.probe_audio_duration_seconds", return_value=3.5),
        patch("app.routers.tts.normalize_audio_for_tts_reference"),
        patch("app.routers.tts.get_tts_model", return_value=fake_model),
    ):
        client = TestClient(app)
        response = _post_synthesize(client)

    assert response.status_code == 200
    assert response.headers["content-type"] == "audio/wav"
    assert "X-Inference-Time-Seconds" in response.headers
    assert "X-Audio-Duration-Seconds" in response.headers
    assert response.headers["X-Model-Used"] == settings.tts_model_id
    # Verify WAV magic bytes
    assert response.content[:4] == b"RIFF"
    assert fake_model.calls[0]["text"] == "Ciao, questa e una frase di test."
    assert fake_model.calls[0]["ref_text"] == "Testo di riferimento parlato nel clip."
    assert fake_model.calls[0]["lang_code"] == "auto"


def test_synthesize_uses_explicit_language_hint(tmp_path: Path) -> None:
    settings = _make_settings(tmp_path)
    fake_model = _FakeTTSModel()

    with (
        patch("app.routers.tts.get_settings", return_value=settings),
        patch("app.routers.tts.probe_audio_duration_seconds", return_value=3.5),
        patch("app.routers.tts.normalize_audio_for_tts_reference"),
        patch("app.routers.tts.get_tts_model", return_value=fake_model),
    ):
        client = TestClient(app)
        response = _post_synthesize(client, language="it")

    assert response.status_code == 200
    assert fake_model.calls[0]["lang_code"] == "italian"


# ── Validation error tests ──────────────────────────────────────────


def test_synthesize_returns_400_for_empty_text(tmp_path: Path) -> None:
    settings = _make_settings(tmp_path)
    with patch("app.routers.tts.get_settings", return_value=settings):
        client = TestClient(app)
        response = _post_synthesize(client, text="   ")

    assert response.status_code == 400
    assert "non-empty" in response.json()["detail"]


def test_synthesize_returns_400_for_unsupported_language(tmp_path: Path) -> None:
    settings = _make_settings(tmp_path)
    with patch("app.routers.tts.get_settings", return_value=settings):
        client = TestClient(app)
        response = _post_synthesize(client, language="Klingon")

    assert response.status_code == 400
    assert "Unsupported TTS language" in response.json()["detail"]


def test_synthesize_returns_400_for_empty_reference_audio(tmp_path: Path) -> None:
    settings = _make_settings(tmp_path)
    with patch("app.routers.tts.get_settings", return_value=settings):
        client = TestClient(app)
        response = _post_synthesize(client, audio_content=b"")

    assert response.status_code == 400
    assert "empty" in response.json()["detail"]


def test_synthesize_returns_400_for_short_reference_audio(tmp_path: Path) -> None:
    settings = _make_settings(tmp_path)
    with (
        patch("app.routers.tts.get_settings", return_value=settings),
        patch("app.routers.tts.probe_audio_duration_seconds", return_value=2.9),
    ):
        client = TestClient(app)
        response = _post_synthesize(client)

    assert response.status_code == 400
    assert "too short" in response.json()["detail"]
    assert "Minimum 3.0s required" in response.json()["detail"]


# ── Infrastructure / model error tests ──────────────────────────────


def test_synthesize_returns_400_for_invalid_audio(tmp_path: Path) -> None:
    settings = _make_settings(tmp_path)
    with (
        patch("app.routers.tts.get_settings", return_value=settings),
        patch(
            "app.routers.tts.probe_audio_duration_seconds",
            side_effect=AudioInputError("invalid audio"),
        ),
    ):
        client = TestClient(app)
        response = _post_synthesize(client)

    assert response.status_code == 400
    assert response.json()["detail"] == "invalid audio"


def test_synthesize_returns_503_when_model_loading_fails(tmp_path: Path) -> None:
    settings = _make_settings(tmp_path)
    with (
        patch("app.routers.tts.get_settings", return_value=settings),
        patch("app.routers.tts.probe_audio_duration_seconds", return_value=3.5),
        patch("app.routers.tts.normalize_audio_for_tts_reference"),
        patch(
            "app.routers.tts.get_tts_model",
            side_effect=TTSLoadError("model unavailable"),
        ),
    ):
        client = TestClient(app)
        response = _post_synthesize(client)

    assert response.status_code == 503
    assert response.json()["detail"] == "model unavailable"


def test_synthesize_returns_503_for_audio_infrastructure_error(tmp_path: Path) -> None:
    settings = _make_settings(tmp_path)
    with (
        patch("app.routers.tts.get_settings", return_value=settings),
        patch(
            "app.routers.tts.probe_audio_duration_seconds",
            side_effect=AudioInfrastructureError("Required binary not found: ffprobe"),
        ),
    ):
        client = TestClient(app)
        response = _post_synthesize(client)

    assert response.status_code == 503
    assert response.json()["detail"] == "Required binary not found: ffprobe"


# ── Memory metrics & caching tests ──────────────────────────────────


def test_synthesize_logs_memory_metrics_on_success(tmp_path: Path) -> None:
    settings = _make_settings(tmp_path)
    fake_model = _FakeTTSModel()

    with (
        patch("app.routers.tts.get_settings", return_value=settings),
        patch("app.routers.tts.probe_audio_duration_seconds", return_value=3.5),
        patch("app.routers.tts.normalize_audio_for_tts_reference"),
        patch("app.routers.tts.get_tts_model", return_value=fake_model),
        patch("app.routers.tts.MemorySampler", _FakeMemorySampler),
        patch("app.routers.tts._log_synthesize_status") as log_status,
    ):
        client = TestClient(app)
        response = _post_synthesize(client)

    assert response.status_code == 200
    assert log_status.call_count == 1
    call_kwargs = log_status.call_args.kwargs
    assert call_kwargs["peak_memory_gb"] == 5.2
    assert call_kwargs["delta_memory_gb"] == 1.5


def test_tts_model_is_cached_after_first_load(tmp_path: Path) -> None:
    settings = _make_settings(tmp_path)
    tts_model_path = settings.hf_home / "Qwen3-TTS-12Hz-1.7B-Base-bf16"
    tts_model_path.mkdir(parents=True)

    reset_tts_model_cache()
    try:
        with patch(
            "app.models.tts_model._load_model", return_value=_FakeTTSModel()
        ) as load:
            first = get_tts_model(settings)
            second = get_tts_model(settings)

        assert first is second
        assert load.call_count == 1
    finally:
        reset_tts_model_cache()


# ── Cleanup tests ───────────────────────────────────────────────────


def test_synthesize_cleans_temp_dir_on_error(tmp_path: Path) -> None:
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
        patch("app.routers.tts.get_settings", return_value=settings),
        patch(
            "app.routers.tts.tempfile.TemporaryDirectory",
            _TrackingTemporaryDirectory,
        ),
        patch(
            "app.routers.tts.probe_audio_duration_seconds",
            side_effect=AudioInputError("bad audio"),
        ),
    ):
        client = TestClient(app)
        response = _post_synthesize(client)

    assert response.status_code == 400
    assert len(created_dirs) == 1
    tracked = created_dirs[0]
    assert tracked.cleaned is True
    assert not Path(tracked.name).exists()


# ── Auto-transcription tests ────────────────────────────────────────


def test_synthesize_auto_transcribes_when_reference_text_omitted(
    tmp_path: Path,
) -> None:
    settings = _make_settings(tmp_path)
    fake_tts = _FakeTTSModel()
    fake_asr = _FakeASRModel()

    with (
        patch("app.routers.tts.get_settings", return_value=settings),
        patch("app.routers.tts.probe_audio_duration_seconds", return_value=3.5),
        patch("app.routers.tts.normalize_audio_for_tts_reference"),
        patch("app.routers.tts.normalize_audio_for_asr"),
        patch("app.routers.tts.get_asr_model", return_value=fake_asr),
        patch("app.routers.tts.get_tts_model", return_value=fake_tts),
    ):
        client = TestClient(app)
        response = _post_synthesize(client, reference_text=_SENTINEL)

    assert response.status_code == 200
    assert response.content[:4] == b"RIFF"
    # The auto-transcribed text should be passed to the TTS model
    assert fake_tts.calls[0]["ref_text"] == "trascrizione automatica del clip"


def test_synthesize_auto_transcribe_uses_asr_autodetect_without_language(
    tmp_path: Path,
) -> None:
    settings = _make_settings(tmp_path)
    fake_tts = _FakeTTSModel()

    with (
        patch("app.routers.tts.get_settings", return_value=settings),
        patch("app.routers.tts.probe_audio_duration_seconds", return_value=3.5),
        patch("app.routers.tts.normalize_audio_for_tts_reference"),
        patch("app.routers.tts.normalize_audio_for_asr"),
        patch("app.routers.tts.get_asr_model", return_value=object()),
        patch("app.routers.tts.get_tts_model", return_value=fake_tts),
        patch(
            "app.routers.tts._transcribe_reference",
            return_value="trascrizione automatica del clip",
        ) as transcribe_reference,
    ):
        client = TestClient(app)
        response = _post_synthesize(client, reference_text=_SENTINEL)

    assert response.status_code == 200
    assert transcribe_reference.call_count == 1
    assert transcribe_reference.call_args.kwargs["prompt_language"] is None


def test_synthesize_auto_transcribe_uses_explicit_language_hint_for_asr(
    tmp_path: Path,
) -> None:
    settings = _make_settings(tmp_path)
    fake_tts = _FakeTTSModel()

    with (
        patch("app.routers.tts.get_settings", return_value=settings),
        patch("app.routers.tts.probe_audio_duration_seconds", return_value=3.5),
        patch("app.routers.tts.normalize_audio_for_tts_reference"),
        patch("app.routers.tts.normalize_audio_for_asr"),
        patch("app.routers.tts.get_asr_model", return_value=object()),
        patch("app.routers.tts.get_tts_model", return_value=fake_tts),
        patch(
            "app.routers.tts._transcribe_reference",
            return_value="trascrizione automatica del clip",
        ) as transcribe_reference,
    ):
        client = TestClient(app)
        response = _post_synthesize(
            client,
            reference_text=_SENTINEL,
            language="it",
        )

    assert response.status_code == 200
    assert transcribe_reference.call_count == 1
    assert transcribe_reference.call_args.kwargs["prompt_language"] == "Italian"


def test_synthesize_auto_transcribe_uses_asr_semaphore(tmp_path: Path) -> None:
    settings = _make_settings(tmp_path)
    fake_tts = _FakeTTSModel()
    fake_asr = _FakeASRModel()
    asr_semaphore = _TrackingAsyncSemaphore()

    with (
        patch("app.routers.tts.get_settings", return_value=settings),
        patch("app.routers.tts.probe_audio_duration_seconds", return_value=3.5),
        patch("app.routers.tts.normalize_audio_for_tts_reference"),
        patch("app.routers.tts.normalize_audio_for_asr"),
        patch("app.routers.tts.get_asr_model", return_value=fake_asr),
        patch("app.routers.tts.get_tts_model", return_value=fake_tts),
        patch("app.routers.tts.ASR_INFERENCE_SEMAPHORE", asr_semaphore),
    ):
        client = TestClient(app)
        response = _post_synthesize(client, reference_text=_SENTINEL)

    assert response.status_code == 200
    assert asr_semaphore.enter_count == 1


def test_synthesize_and_transcribe_share_asr_semaphore() -> None:
    assert tts_router.ASR_INFERENCE_SEMAPHORE is asr_router.ASR_INFERENCE_SEMAPHORE


def test_synthesize_logs_reference_text_metadata_without_raw_content(
    tmp_path: Path,
) -> None:
    settings = _make_settings(tmp_path)
    fake_tts = _FakeTTSModel()
    fake_asr = _FakeASRModel()

    with (
        patch("app.routers.tts.get_settings", return_value=settings),
        patch("app.routers.tts.probe_audio_duration_seconds", return_value=3.5),
        patch("app.routers.tts.normalize_audio_for_tts_reference"),
        patch("app.routers.tts.normalize_audio_for_asr"),
        patch("app.routers.tts.get_asr_model", return_value=fake_asr),
        patch("app.routers.tts.get_tts_model", return_value=fake_tts),
        patch("app.routers.tts._log_synthesize_status"),
        patch("app.routers.tts.logger.info") as log_info,
    ):
        client = TestClient(app)
        response = _post_synthesize(client, reference_text=_SENTINEL)

    assert response.status_code == 200

    expected_reference_text = "trascrizione automatica del clip"
    event_payload: dict[str, object] | None = None
    for call in log_info.call_args_list:
        if not call.args:
            continue
        message = call.args[0]
        if not isinstance(message, str):
            continue
        payload = json.loads(message)
        if payload.get("event") == "reference_text_resolved":
            event_payload = payload
            break

    assert event_payload is not None
    assert event_payload["reference_text_source"] == "auto_asr"
    assert event_payload["reference_text_chars"] == len(expected_reference_text)
    assert event_payload["reference_text_words"] == len(expected_reference_text.split())
    assert event_payload["reference_audio_duration_seconds"] == 3.5
    assert event_payload["language"] == "auto"
    assert "reference_text" not in event_payload


def test_synthesize_auto_transcribes_when_reference_text_is_blank(
    tmp_path: Path,
) -> None:
    settings = _make_settings(tmp_path)
    fake_tts = _FakeTTSModel()
    fake_asr = _FakeASRModel()

    with (
        patch("app.routers.tts.get_settings", return_value=settings),
        patch("app.routers.tts.probe_audio_duration_seconds", return_value=3.5),
        patch("app.routers.tts.normalize_audio_for_tts_reference"),
        patch("app.routers.tts.normalize_audio_for_asr"),
        patch("app.routers.tts.get_asr_model", return_value=fake_asr),
        patch("app.routers.tts.get_tts_model", return_value=fake_tts),
    ):
        client = TestClient(app)
        response = _post_synthesize(client, reference_text="   ")

    assert response.status_code == 200
    assert fake_tts.calls[0]["ref_text"] == "trascrizione automatica del clip"


def test_synthesize_prefers_explicit_reference_text_over_auto(
    tmp_path: Path,
) -> None:
    settings = _make_settings(tmp_path)
    fake_tts = _FakeTTSModel()

    with (
        patch("app.routers.tts.get_settings", return_value=settings),
        patch("app.routers.tts.probe_audio_duration_seconds", return_value=3.5),
        patch("app.routers.tts.normalize_audio_for_tts_reference"),
        patch("app.routers.tts.get_tts_model", return_value=fake_tts),
        patch("app.routers.tts.get_asr_model") as asr_mock,
    ):
        client = TestClient(app)
        response = _post_synthesize(client, reference_text="testo esplicito")

    assert response.status_code == 200
    assert fake_tts.calls[0]["ref_text"] == "testo esplicito"
    # ASR model should NOT have been loaded
    asr_mock.assert_not_called()
