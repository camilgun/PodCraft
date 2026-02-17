"""Audio helpers for probing duration and ASR normalization."""

from __future__ import annotations

import subprocess
from pathlib import Path


class AudioProcessingError(RuntimeError):
    """Raised when audio processing fails."""


class AudioInputError(AudioProcessingError):
    """Raised when the uploaded audio content is invalid for processing."""


class AudioInfrastructureError(AudioProcessingError):
    """Raised when required audio processing infrastructure is unavailable."""


def _run_command(command: list[str]) -> subprocess.CompletedProcess[str]:
    """Run a command and return the completed process."""
    try:
        return subprocess.run(
            command,
            capture_output=True,
            text=True,
            check=False,
        )
    except FileNotFoundError as exc:
        raise AudioInfrastructureError(
            f"Required binary not found: {command[0]}"
        ) from exc


def probe_audio_duration_seconds(audio_path: Path) -> float:
    """Return audio duration in seconds using ffprobe."""
    result = _run_command(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            str(audio_path),
        ]
    )

    if result.returncode != 0:
        stderr = result.stderr.strip() or "ffprobe failed"
        raise AudioInputError(stderr)

    duration_raw = result.stdout.strip()
    try:
        duration = float(duration_raw)
    except ValueError as exc:
        raise AudioInputError(
            f"Unable to parse audio duration from ffprobe output: {duration_raw!r}"
        ) from exc

    if duration <= 0:
        raise AudioInputError(f"Invalid audio duration: {duration}")

    return duration


def normalize_audio_for_asr(input_path: Path, output_path: Path) -> None:
    """Normalize an input audio file to mono 16k WAV for ASR inference."""
    result = _run_command(
        [
            "ffmpeg",
            "-y",
            "-loglevel",
            "error",
            "-i",
            str(input_path),
            "-ac",
            "1",
            "-ar",
            "16000",
            str(output_path),
        ]
    )

    if result.returncode != 0:
        stderr = result.stderr.strip() or "ffmpeg failed"
        raise AudioInputError(stderr)

    if not output_path.exists():
        raise AudioInfrastructureError("ffmpeg did not produce normalized output")


def normalize_audio_for_tts_reference(input_path: Path, output_path: Path) -> None:
    """Normalize reference audio to mono 24 kHz WAV for TTS voice cloning.

    Higher sample rate than ASR normalization (24 kHz vs 16 kHz) to preserve
    voice characteristics for cloning.  The TTS model resamples internally to
    its native codec rate.
    """
    result = _run_command(
        [
            "ffmpeg",
            "-y",
            "-loglevel",
            "error",
            "-i",
            str(input_path),
            "-ac",
            "1",
            "-ar",
            "24000",
            str(output_path),
        ]
    )

    if result.returncode != 0:
        stderr = result.stderr.strip() or "ffmpeg failed"
        raise AudioInputError(stderr)

    if not output_path.exists():
        raise AudioInfrastructureError("ffmpeg did not produce normalized reference audio")
