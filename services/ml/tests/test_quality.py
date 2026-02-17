"""Tests for POST /assess-quality."""

from __future__ import annotations

import shutil
import tempfile
from pathlib import Path
from unittest.mock import patch

import numpy as np
import torch
from fastapi.testclient import TestClient

from app.lib.audio import AudioInfrastructureError, AudioInputError
from app.main import app
from app.models.quality_model import (
    QualityModelLoadError,
    get_quality_assessor,
    reset_quality_assessor_cache,
)


class _SequencedAssessor:
    def __init__(self, mos_scores: list[float]) -> None:
        self._mos_scores = mos_scores
        self.call_index = 0
        self.sample_rates: list[int] = []
        self.window_lengths: list[int] = []

    def __call__(self, preds: torch.Tensor, fs: int) -> torch.Tensor:
        self.sample_rates.append(fs)
        self.window_lengths.append(int(preds.numel()))
        score_idx = min(self.call_index, len(self._mos_scores) - 1)
        mos = self._mos_scores[score_idx]
        self.call_index += 1
        return torch.tensor([mos, 2.0, 2.1, 2.2, 3.0], dtype=torch.float32)


class _BadShapeAssessor:
    def __call__(self, preds: torch.Tensor, fs: int) -> torch.Tensor:
        _ = preds
        _ = fs
        return torch.tensor([3.0, 2.0, 2.0, 2.0], dtype=torch.float32)


class _OutOfRangeAssessor:
    def __call__(self, preds: torch.Tensor, fs: int) -> torch.Tensor:
        _ = preds
        _ = fs
        return torch.tensor([0.8, 5.8, 2.5, 0.4, 9.0], dtype=torch.float32)


class _FakeMemorySampler:
    def __init__(self, *, sample_interval_seconds: float) -> None:
        self.sample_interval_seconds = sample_interval_seconds
        self.peak_memory_gb = 1.8
        self.delta_memory_gb = 0.4

    async def __aenter__(self) -> _FakeMemorySampler:
        return self

    async def __aexit__(self, exc_type: object, exc: object, tb: object) -> None:
        _ = exc_type
        _ = exc
        _ = tb
        return None


def _post_assess_quality(
    client: TestClient,
    *,
    audio_content: bytes = b"fake-audio",
    window_seconds: float | None = None,
    min_window_seconds: float | None = None,
) -> object:
    data: dict[str, str] = {}
    if window_seconds is not None:
        data["window_seconds"] = str(window_seconds)
    if min_window_seconds is not None:
        data["min_window_seconds"] = str(min_window_seconds)
    return client.post(
        "/assess-quality",
        files={"file": ("sample.wav", audio_content, "audio/wav")},
        data=data,
    )


def test_assess_quality_defaults_to_3_second_windows() -> None:
    assessor = _SequencedAssessor([4.0, 3.5, 3.0])
    waveform = np.zeros(9 * 16000, dtype=np.float32)

    with (
        patch("app.routers.quality.probe_audio_duration_seconds", return_value=12.0),
        patch("app.routers.quality.normalize_audio_for_asr"),
        patch("app.routers.quality._read_waveform", return_value=(waveform, 16000)),
        patch("app.routers.quality.get_quality_assessor", return_value=assessor),
    ):
        client = TestClient(app)
        response = _post_assess_quality(client)

    assert response.status_code == 200
    data = response.json()
    assert len(data["windows"]) == 3
    assert data["windows"][0]["window_start"] == 0
    assert data["windows"][0]["window_end"] == 3
    assert data["windows"][1]["window_start"] == 3
    assert data["windows"][1]["window_end"] == 6
    assert data["windows"][2]["window_start"] == 6
    assert data["windows"][2]["window_end"] == 9
    assert abs(data["average_mos"] - ((4.0 + 3.5 + 3.0) / 3)) < 1e-9
    assert isinstance(data["inference_time_seconds"], float)
    assert assessor.sample_rates == [16000, 16000, 16000]
    assert assessor.window_lengths == [48000, 48000, 48000]


def test_assess_quality_derives_min_window_seconds_from_window_seconds() -> None:
    assessor = _SequencedAssessor([4.0, 3.5])
    waveform = np.zeros(5 * 16000, dtype=np.float32)

    with (
        patch("app.routers.quality.probe_audio_duration_seconds", return_value=5.0),
        patch("app.routers.quality.normalize_audio_for_asr"),
        patch("app.routers.quality._read_waveform", return_value=(waveform, 16000)),
        patch("app.routers.quality.get_quality_assessor", return_value=assessor),
    ):
        client = TestClient(app)
        response = _post_assess_quality(client, window_seconds=2.0)

    assert response.status_code == 200
    data = response.json()
    # Base split would be [0-2], [2-4], [4-5]; tail 1s is merged because min defaults to window(2s)
    assert len(data["windows"]) == 2
    assert data["windows"][0]["window_start"] == 0
    assert data["windows"][0]["window_end"] == 2
    assert data["windows"][1]["window_start"] == 2
    assert data["windows"][1]["window_end"] == 5
    # Duration-weighted mean: (4.0*2s + 3.5*3s) / 5s
    assert abs(data["average_mos"] - ((4.0 * 2.0 + 3.5 * 3.0) / 5.0)) < 1e-9


def test_assess_quality_keeps_short_tail_when_min_window_seconds_is_small() -> None:
    assessor = _SequencedAssessor([4.0, 3.5, 2.5, 2.3])
    waveform = np.zeros(10 * 16000, dtype=np.float32)

    with (
        patch("app.routers.quality.probe_audio_duration_seconds", return_value=10.0),
        patch("app.routers.quality.normalize_audio_for_asr"),
        patch("app.routers.quality._read_waveform", return_value=(waveform, 16000)),
        patch("app.routers.quality.get_quality_assessor", return_value=assessor),
    ):
        client = TestClient(app)
        response = _post_assess_quality(
            client,
            window_seconds=3.0,
            min_window_seconds=1.0,
        )

    assert response.status_code == 200
    data = response.json()
    assert len(data["windows"]) == 4
    assert data["windows"][3]["window_start"] == 9
    assert data["windows"][3]["window_end"] == 10
    # Duration-weighted mean with [3s, 3s, 3s, 1s] windows
    expected_average_mos = (4.0 * 3.0 + 3.5 * 3.0 + 2.5 * 3.0 + 2.3 * 1.0) / 10.0
    assert abs(data["average_mos"] - expected_average_mos) < 1e-6


def test_assess_quality_short_audio_returns_single_window() -> None:
    assessor = _SequencedAssessor([3.2])
    waveform = np.zeros(3 * 16000, dtype=np.float32)

    with (
        patch("app.routers.quality.probe_audio_duration_seconds", return_value=3.0),
        patch("app.routers.quality.normalize_audio_for_asr"),
        patch("app.routers.quality._read_waveform", return_value=(waveform, 16000)),
        patch("app.routers.quality.get_quality_assessor", return_value=assessor),
    ):
        client = TestClient(app)
        response = _post_assess_quality(client)

    assert response.status_code == 200
    data = response.json()
    assert len(data["windows"]) == 1
    assert data["windows"][0]["window_start"] == 0
    assert data["windows"][0]["window_end"] == 3
    assert abs(data["average_mos"] - 3.2) < 1e-6


def test_assess_quality_returns_400_for_empty_file() -> None:
    client = TestClient(app)
    response = _post_assess_quality(client, audio_content=b"")

    assert response.status_code == 400
    assert response.json()["detail"] == "Uploaded file is empty"


def test_assess_quality_rejects_invalid_min_window_seconds() -> None:
    client = TestClient(app)
    response = _post_assess_quality(client, min_window_seconds=0.5)

    assert response.status_code == 400
    assert response.json()["detail"] == (
        "Field 'min_window_seconds' must be greater than or equal to 1.0"
    )


def test_assess_quality_rejects_invalid_window_seconds() -> None:
    client = TestClient(app)
    response = _post_assess_quality(client, window_seconds=0.5)

    assert response.status_code == 400
    assert response.json()["detail"] == (
        "Field 'window_seconds' must be greater than or equal to 1.0"
    )


def test_assess_quality_rejects_nan_window_seconds() -> None:
    client = TestClient(app)
    response = _post_assess_quality(client, window_seconds=float("nan"))

    assert response.status_code == 400
    assert response.json()["detail"] == "Field 'window_seconds' must be a finite number"


def test_assess_quality_rejects_infinite_window_seconds() -> None:
    client = TestClient(app)
    response = _post_assess_quality(client, window_seconds=float("inf"))

    assert response.status_code == 400
    assert response.json()["detail"] == "Field 'window_seconds' must be a finite number"


def test_assess_quality_rejects_nan_min_window_seconds() -> None:
    client = TestClient(app)
    response = _post_assess_quality(
        client,
        window_seconds=3.0,
        min_window_seconds=float("nan"),
    )

    assert response.status_code == 400
    assert response.json()["detail"] == (
        "Field 'min_window_seconds' must be a finite number"
    )


def test_assess_quality_rejects_infinite_min_window_seconds() -> None:
    client = TestClient(app)
    response = _post_assess_quality(
        client,
        window_seconds=3.0,
        min_window_seconds=float("inf"),
    )

    assert response.status_code == 400
    assert response.json()["detail"] == (
        "Field 'min_window_seconds' must be a finite number"
    )


def test_assess_quality_rejects_min_window_seconds_greater_than_window_seconds() -> None:
    client = TestClient(app)
    response = _post_assess_quality(
        client,
        window_seconds=3.0,
        min_window_seconds=4.0,
    )

    assert response.status_code == 400
    assert (
        response.json()["detail"]
        == "Field 'min_window_seconds' cannot be greater than 'window_seconds'"
    )


def test_assess_quality_returns_400_for_invalid_audio() -> None:
    with patch(
        "app.routers.quality.probe_audio_duration_seconds",
        side_effect=AudioInputError("invalid audio"),
    ):
        client = TestClient(app)
        response = _post_assess_quality(client)

    assert response.status_code == 400
    assert response.json()["detail"] == "invalid audio"


def test_assess_quality_returns_503_for_audio_infrastructure_error() -> None:
    with patch(
        "app.routers.quality.probe_audio_duration_seconds",
        side_effect=AudioInfrastructureError("Required binary not found: ffprobe"),
    ):
        client = TestClient(app)
        response = _post_assess_quality(client)

    assert response.status_code == 503
    assert response.json()["detail"] == "Required binary not found: ffprobe"


def test_assess_quality_returns_503_when_quality_model_loading_fails() -> None:
    waveform = np.zeros(5 * 16000, dtype=np.float32)
    with (
        patch("app.routers.quality.probe_audio_duration_seconds", return_value=5.0),
        patch("app.routers.quality.normalize_audio_for_asr"),
        patch("app.routers.quality._read_waveform", return_value=(waveform, 16000)),
        patch(
            "app.routers.quality.get_quality_assessor",
            side_effect=QualityModelLoadError("quality model unavailable"),
        ),
    ):
        client = TestClient(app)
        response = _post_assess_quality(client)

    assert response.status_code == 503
    assert response.json()["detail"] == "quality model unavailable"


def test_assess_quality_returns_502_for_malformed_model_output() -> None:
    waveform = np.zeros(5 * 16000, dtype=np.float32)
    with (
        patch("app.routers.quality.probe_audio_duration_seconds", return_value=5.0),
        patch("app.routers.quality.normalize_audio_for_asr"),
        patch("app.routers.quality._read_waveform", return_value=(waveform, 16000)),
        patch("app.routers.quality.get_quality_assessor", return_value=_BadShapeAssessor()),
    ):
        client = TestClient(app)
        response = _post_assess_quality(client)

    assert response.status_code == 502
    assert response.json()["detail"] == "Quality assessor returned an unexpected output shape"


def test_assess_quality_clamps_out_of_range_scores_and_logs_warning() -> None:
    waveform = np.zeros(5 * 16000, dtype=np.float32)
    with (
        patch("app.routers.quality.probe_audio_duration_seconds", return_value=5.0),
        patch("app.routers.quality.normalize_audio_for_asr"),
        patch("app.routers.quality._read_waveform", return_value=(waveform, 16000)),
        patch("app.routers.quality.get_quality_assessor", return_value=_OutOfRangeAssessor()),
        patch("app.routers.quality._log_quality_clamped_scores") as log_clamped,
    ):
        client = TestClient(app)
        response = _post_assess_quality(client)

    assert response.status_code == 200
    data = response.json()
    assert len(data["windows"]) == 1
    assert data["windows"][0]["mos"] == 1.0
    assert data["windows"][0]["noisiness"] == 5.0
    assert data["windows"][0]["discontinuity"] == 2.5
    assert data["windows"][0]["coloration"] == 1.0
    assert data["windows"][0]["loudness"] == 5.0
    assert data["average_mos"] == 1.0
    assert log_clamped.call_count == 1


def test_assess_quality_logs_memory_metrics_on_success() -> None:
    assessor = _SequencedAssessor([3.7])
    waveform = np.zeros(5 * 16000, dtype=np.float32)

    with (
        patch("app.routers.quality.probe_audio_duration_seconds", return_value=5.0),
        patch("app.routers.quality.normalize_audio_for_asr"),
        patch("app.routers.quality._read_waveform", return_value=(waveform, 16000)),
        patch("app.routers.quality.get_quality_assessor", return_value=assessor),
        patch("app.routers.quality.MemorySampler", _FakeMemorySampler),
        patch("app.routers.quality._log_quality_status") as log_status,
    ):
        client = TestClient(app)
        response = _post_assess_quality(client)

    assert response.status_code == 200
    assert log_status.call_count == 1
    call_kwargs = log_status.call_args.kwargs
    assert call_kwargs["peak_memory_gb"] == 1.8
    assert call_kwargs["delta_memory_gb"] == 0.4
    assert call_kwargs["window_count"] == 1
    assert abs(call_kwargs["average_mos"] - 3.7) < 1e-6


def test_assess_quality_cleans_temp_dir_on_error() -> None:
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
        patch(
            "app.routers.quality.tempfile.TemporaryDirectory",
            _TrackingTemporaryDirectory,
        ),
        patch(
            "app.routers.quality.probe_audio_duration_seconds",
            side_effect=AudioInputError("bad audio"),
        ),
    ):
        client = TestClient(app)
        response = _post_assess_quality(client)

    assert response.status_code == 400
    assert len(created_dirs) == 1
    tracked = created_dirs[0]
    assert tracked.cleaned is True
    assert not Path(tracked.name).exists()


def test_quality_assessor_is_cached_after_first_load() -> None:
    reset_quality_assessor_cache()
    dummy_assessor = _SequencedAssessor([3.0])
    try:
        with patch(
            "app.models.quality_model._load_quality_assessor",
            return_value=dummy_assessor,
        ) as load:
            first = get_quality_assessor()
            second = get_quality_assessor()

        assert first is second
        assert load.call_count == 1
    finally:
        reset_quality_assessor_cache()
