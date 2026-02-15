"""Integration tests for ffprobe/ffmpeg audio preprocessing."""

from __future__ import annotations

import math
import shutil
import struct
import wave
from dataclasses import dataclass
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.lib.audio import normalize_audio_for_asr, probe_audio_duration_seconds
from app.main import app


def _has_ffmpeg_binaries() -> bool:
    """Return whether ffmpeg and ffprobe are available on PATH."""
    return shutil.which("ffmpeg") is not None and shutil.which("ffprobe") is not None


requires_ffmpeg = pytest.mark.skipif(
    not _has_ffmpeg_binaries(),
    reason="ffmpeg/ffprobe are required for integration audio tests",
)


def _create_wav_file(
    path: Path,
    *,
    duration_seconds: float,
    sample_rate: int,
    channels: int,
) -> None:
    """Create a deterministic sine-wave PCM WAV file."""
    frame_count = max(1, int(duration_seconds * sample_rate))
    frequency_hz = 440.0
    amplitude = 12_000

    with wave.open(str(path), "wb") as wav_file:
        wav_file.setnchannels(channels)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)

        for frame_index in range(frame_count):
            sample = int(
                amplitude
                * math.sin((2 * math.pi * frequency_hz * frame_index) / sample_rate)
            )
            frame_bytes = struct.pack("<h", sample)
            wav_file.writeframesraw(frame_bytes * channels)

        wav_file.writeframes(b"")


@requires_ffmpeg
def test_probe_audio_duration_seconds_with_real_wav(tmp_path: Path) -> None:
    input_path = tmp_path / "probe-input.wav"
    _create_wav_file(
        input_path,
        duration_seconds=1.2,
        sample_rate=44_100,
        channels=2,
    )

    duration = probe_audio_duration_seconds(input_path)

    assert duration > 1.0
    assert duration < 1.4


@requires_ffmpeg
def test_normalize_audio_for_asr_outputs_mono_16k_wav(tmp_path: Path) -> None:
    input_path = tmp_path / "normalize-input.wav"
    output_path = tmp_path / "normalize-output.wav"
    _create_wav_file(
        input_path,
        duration_seconds=0.8,
        sample_rate=48_000,
        channels=2,
    )

    normalize_audio_for_asr(input_path, output_path)

    assert output_path.exists()
    with wave.open(str(output_path), "rb") as wav_file:
        assert wav_file.getnchannels() == 1
        assert wav_file.getframerate() == 16_000
        assert wav_file.getnframes() > 0


@dataclass
class _FakeOutput:
    text: str
    language: str | None = None


class _FakeModel:
    def __init__(self) -> None:
        self.calls: list[dict[str, object]] = []
        self.audio_paths: list[str] = []

    def generate(
        self,
        audio_path: str,
        *,
        verbose: bool = False,
        **kwargs: object,
    ) -> _FakeOutput:
        self.audio_paths.append(audio_path)
        self.calls.append({"verbose": verbose, **kwargs})
        return _FakeOutput(text="ciao integrazione", language="it")


@requires_ffmpeg
def test_transcribe_uses_real_audio_preprocessing_with_mock_model(tmp_path: Path) -> None:
    settings = Settings(
        hf_home=tmp_path / "models",
        asr_default_language=None,
    )
    fake_model = _FakeModel()

    input_path = tmp_path / "transcribe-input.wav"
    _create_wav_file(
        input_path,
        duration_seconds=0.7,
        sample_rate=44_100,
        channels=2,
    )
    payload = input_path.read_bytes()

    with (
        patch("app.routers.asr.get_settings", return_value=settings),
        patch("app.routers.asr.get_asr_model", return_value=fake_model),
    ):
        client = TestClient(app)
        response = client.post(
            "/transcribe",
            files={"file": ("transcribe-input.wav", payload, "audio/wav")},
        )

    assert response.status_code == 200
    data = response.json()
    assert data["text"] == "ciao integrazione"
    assert data["language"] == "it"
    assert data["audio_duration_seconds"] > 0
    assert data["inference_time_seconds"] >= 0
    assert data["model_used"] == settings.asr_model_id
    assert len(fake_model.calls) == 1
    assert "language" not in fake_model.calls[0]
    assert len(fake_model.audio_paths) == 1
    assert Path(fake_model.audio_paths[0]).name == "normalized.wav"
