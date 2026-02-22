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


class AudioChunk:
    """Metadata for a single audio chunk produced by split_audio_into_chunks."""

    __slots__ = ("path", "start_offset", "duration")

    def __init__(self, path: Path, start_offset: float, duration: float) -> None:
        self.path = path
        self.start_offset = start_offset
        self.duration = duration


def split_audio_into_chunks(
    audio_path: Path,
    output_dir: Path,
    total_duration: float,
    chunk_seconds: float = 240.0,
) -> list[AudioChunk]:
    """Split an audio file into fixed-length WAV chunks using ffmpeg.

    Returns a list of AudioChunk with the file path, start offset, and actual
    duration of each chunk.  If the file is shorter than *chunk_seconds* a
    single chunk spanning the whole file is returned (as a copy, so callers
    always receive files inside *output_dir*).
    """
    chunks: list[AudioChunk] = []
    offset = 0.0
    index = 0

    while offset < total_duration:
        remaining = total_duration - offset
        seg_duration = min(chunk_seconds, remaining)
        out_path = output_dir / f"chunk_{index:04d}.wav"

        result = _run_command(
            [
                "ffmpeg",
                "-y",
                "-loglevel",
                "error",
                "-ss",
                str(offset),
                "-t",
                str(seg_duration),
                "-i",
                str(audio_path),
                "-ac",
                "1",
                "-ar",
                "16000",
                str(out_path),
            ]
        )

        if result.returncode != 0:
            stderr = result.stderr.strip() or "ffmpeg chunk split failed"
            raise AudioInfrastructureError(stderr)

        if not out_path.exists():
            raise AudioInfrastructureError(
                f"ffmpeg did not produce chunk at {out_path}"
            )

        # Probe actual chunk duration (may differ slightly from requested)
        actual_duration = probe_audio_duration_seconds(out_path)
        chunks.append(AudioChunk(out_path, offset, actual_duration))

        offset += seg_duration
        index += 1

    return chunks
