"""Audio quality assessment routes."""

from __future__ import annotations

import json
import logging
import math
import tempfile
import time
from pathlib import Path
from typing import Annotated

import numpy as np
import soundfile as sf
import torch
from fastapi import APIRouter, File, Form, HTTPException, UploadFile, status
from starlette.concurrency import run_in_threadpool

from app.config import NISQA_LABEL
from app.lib.audio import (
    AudioInfrastructureError,
    AudioInputError,
    normalize_audio_for_asr,
    probe_audio_duration_seconds,
)
from app.lib.inference_limits import QUALITY_INFERENCE_SEMAPHORE
from app.lib.memory import MemorySampler
from app.models.quality_model import QualityModelLoadError, get_quality_assessor
from app.schemas import QualityResponse, QualityWindow

logger = logging.getLogger("podcraft.ml")

router = APIRouter(tags=["quality"])

READ_CHUNK_SIZE = 1024 * 1024
MEMORY_SAMPLE_INTERVAL_SECONDS = 0.5
DEFAULT_WINDOW_SECONDS = 3.0
MIN_ALLOWED_WINDOW_SECONDS = 1.0


class QualityOutputError(RuntimeError):
    """Raised when NISQA output is structurally invalid."""


WindowSlice = tuple[float, float, np.ndarray]
ScoreTuple = tuple[float, float, float, float, float]
MIN_QUALITY_SCORE = 1.0
MAX_QUALITY_SCORE = 5.0


def _log_quality_status(
    *,
    status_value: str,
    duration_seconds: float,
    error: str | None = None,
    audio_duration_seconds: float | None = None,
    inference_time_seconds: float | None = None,
    window_count: int | None = None,
    average_mos: float | None = None,
    peak_memory_gb: float | None = None,
    delta_memory_gb: float | None = None,
    window_seconds: float | None = None,
    min_window_seconds: float | None = None,
) -> None:
    payload = {
        "jobId": None,
        "recordingId": None,
        "step": "assess-quality",
        "status": status_value,
        "duration": duration_seconds,
        "error": error,
        "audio_duration_seconds": audio_duration_seconds,
        "inference_time_seconds": inference_time_seconds,
        "model_used": NISQA_LABEL,
        "window_count": window_count,
        "average_mos": average_mos,
        "peak_memory_gb": peak_memory_gb,
        "delta_memory_gb": delta_memory_gb,
        "window_seconds": window_seconds,
        "min_window_seconds": min_window_seconds,
    }
    logger.info(json.dumps(payload))


def _log_quality_clamped_scores(
    *,
    window_start: float,
    window_end: float,
    raw_scores: list[float],
    clamped_scores: list[float],
) -> None:
    payload = {
        "jobId": None,
        "recordingId": None,
        "step": "assess-quality",
        "status": "warning",
        "event": "quality_score_clamped",
        "model_used": NISQA_LABEL,
        "window_start": window_start,
        "window_end": window_end,
        "raw_scores": raw_scores,
        "clamped_scores": clamped_scores,
        "valid_range": [MIN_QUALITY_SCORE, MAX_QUALITY_SCORE],
    }
    logger.warning(json.dumps(payload))


async def _save_upload(upload: UploadFile, destination: Path) -> int:
    """Save an uploaded file to destination and return bytes written."""
    total_bytes = 0
    with destination.open("wb") as output:
        while True:
            chunk = await upload.read(READ_CHUNK_SIZE)
            if not chunk:
                break
            output.write(chunk)
            total_bytes += len(chunk)
    return total_bytes


def _read_waveform(audio_path: Path) -> tuple[np.ndarray, int]:
    """Read a WAV file as mono float32 waveform and sample rate."""
    waveform, sample_rate = sf.read(str(audio_path), dtype="float32")

    if sample_rate <= 0:
        raise AudioInputError("Invalid sample rate in normalized audio")

    if waveform.ndim == 0:
        raise AudioInputError("Normalized audio has invalid shape")

    if waveform.ndim == 2:
        waveform = waveform.mean(axis=1, dtype=np.float32)
    elif waveform.ndim > 2:
        raise AudioInputError("Normalized audio has unsupported dimensions")

    if waveform.size == 0:
        raise AudioInputError("Uploaded audio has no samples after normalization")

    return waveform.astype(np.float32, copy=False), int(sample_rate)


def _build_windows(
    waveform: np.ndarray,
    *,
    sample_rate: int,
    window_seconds: float,
) -> list[WindowSlice]:
    """Split waveform into contiguous fixed windows, keeping the final partial chunk."""
    if sample_rate <= 0:
        raise ValueError("sample_rate must be positive")

    window_samples = int(round(window_seconds * sample_rate))
    if window_samples <= 0:
        raise ValueError("window size must be positive")

    windows: list[WindowSlice] = []
    for start in range(0, waveform.shape[0], window_samples):
        end = min(start + window_samples, waveform.shape[0])
        segment = waveform[start:end]
        if segment.size == 0:
            continue
        windows.append((start / sample_rate, end / sample_rate, segment))

    if not windows:
        raise AudioInputError("Unable to build quality windows from audio")

    return windows


def _merge_short_final_windows(
    windows: list[WindowSlice],
    *,
    min_window_seconds: float,
) -> list[WindowSlice]:
    """Merge trailing windows until the final one satisfies the minimum duration."""
    if min_window_seconds <= 0:
        raise ValueError("min_window_seconds must be > 0")

    merged_windows = list(windows)
    while len(merged_windows) >= 2:
        last_start, last_end, last_segment = merged_windows[-1]
        last_duration = last_end - last_start
        if last_duration >= min_window_seconds:
            break

        prev_start, _, prev_segment = merged_windows[-2]
        combined_segment = np.concatenate((prev_segment, last_segment))
        merged_windows[-2] = (prev_start, last_end, combined_segment)
        merged_windows.pop()

    return merged_windows


def _normalize_score(value: float) -> tuple[float, bool]:
    """Normalize a score to [1, 5], preserving explicit failure for non-finite values."""
    if not math.isfinite(value):
        raise QualityOutputError("Quality assessor returned a non-finite score")
    clamped = min(MAX_QUALITY_SCORE, max(MIN_QUALITY_SCORE, float(value)))
    return clamped, clamped != value


def _score_window(
    segment: np.ndarray,
    *,
    sample_rate: int,
    assessor: object,
) -> tuple[ScoreTuple, list[float] | None]:
    """Run NISQA on one window and return five quality dimensions."""
    input_tensor = torch.from_numpy(segment.astype(np.float32, copy=False))

    if not callable(assessor):
        raise QualityOutputError("Quality assessor is not callable")
    output = assessor(input_tensor, sample_rate)
    flattened = torch.as_tensor(output, dtype=torch.float32).reshape(-1)
    if flattened.numel() != 5:
        raise QualityOutputError("Quality assessor returned an unexpected output shape")

    raw_scores = [float(value.item()) for value in flattened]
    normalized_scores: list[float] = []
    has_clamped = False
    for raw_score in raw_scores:
        normalized, clamped = _normalize_score(raw_score)
        normalized_scores.append(normalized)
        has_clamped = has_clamped or clamped

    scores: ScoreTuple = (
        normalized_scores[0],
        normalized_scores[1],
        normalized_scores[2],
        normalized_scores[3],
        normalized_scores[4],
    )
    return scores, raw_scores if has_clamped else None


def _assess_windows(
    windows: list[WindowSlice],
    *,
    sample_rate: int,
    assessor: object,
) -> list[QualityWindow]:
    """Assess each window and map scores to response models."""
    quality_windows: list[QualityWindow] = []
    for window_start, window_end, segment in windows:
        scores, raw_scores = _score_window(
            segment,
            sample_rate=sample_rate,
            assessor=assessor,
        )
        mos, noisiness, discontinuity, coloration, loudness = scores
        if raw_scores is not None:
            _log_quality_clamped_scores(
                window_start=window_start,
                window_end=window_end,
                raw_scores=raw_scores,
                clamped_scores=[
                    mos,
                    noisiness,
                    discontinuity,
                    coloration,
                    loudness,
                ],
            )
        quality_windows.append(
            QualityWindow(
                window_start=window_start,
                window_end=window_end,
                mos=mos,
                noisiness=noisiness,
                discontinuity=discontinuity,
                coloration=coloration,
                loudness=loudness,
            )
        )
    return quality_windows


def _average_mos(windows: list[QualityWindow]) -> float:
    """Compute duration-weighted mean of MOS across windows."""
    if not windows:
        raise ValueError("Cannot compute average MOS for empty windows")

    weighted_mos_sum = 0.0
    total_duration_seconds = 0.0
    for window in windows:
        window_duration_seconds = window.window_end - window.window_start
        if window_duration_seconds <= 0:
            raise ValueError("Cannot compute average MOS with non-positive window duration")
        weighted_mos_sum += window.mos * window_duration_seconds
        total_duration_seconds += window_duration_seconds

    if total_duration_seconds <= 0:
        raise ValueError("Cannot compute average MOS for zero total duration")

    return float(weighted_mos_sum / total_duration_seconds)


def _resolve_window_settings(
    *,
    window_seconds: float | None,
    min_window_seconds: float | None,
) -> tuple[float, float]:
    """Resolve optional request settings and enforce guardrails."""
    resolved_window_seconds = (
        DEFAULT_WINDOW_SECONDS if window_seconds is None else window_seconds
    )
    if not math.isfinite(resolved_window_seconds):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Field 'window_seconds' must be a finite number",
        )

    if resolved_window_seconds < MIN_ALLOWED_WINDOW_SECONDS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Field 'window_seconds' must be greater than or equal to "
                f"{MIN_ALLOWED_WINDOW_SECONDS}"
            ),
        )

    resolved_min_window_seconds = (
        resolved_window_seconds
        if min_window_seconds is None
        else min_window_seconds
    )
    if not math.isfinite(resolved_min_window_seconds):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Field 'min_window_seconds' must be a finite number",
        )

    if resolved_min_window_seconds < MIN_ALLOWED_WINDOW_SECONDS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Field 'min_window_seconds' must be greater than or equal to "
                f"{MIN_ALLOWED_WINDOW_SECONDS}"
            ),
        )

    if resolved_min_window_seconds > resolved_window_seconds:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Field 'min_window_seconds' cannot be greater than 'window_seconds'",
        )

    return float(resolved_window_seconds), float(resolved_min_window_seconds)


@router.post("/assess-quality", response_model=QualityResponse)
async def assess_quality(
    file: Annotated[UploadFile, File(...)],
    window_seconds: Annotated[float | None, Form()] = None,
    min_window_seconds: Annotated[float | None, Form()] = None,
) -> QualityResponse:
    """Assess quality of uploaded audio with NISQA over configurable windows."""
    start_time = time.perf_counter()
    temp_dir = tempfile.TemporaryDirectory(prefix="podcraft-quality-")
    temp_dir_path = Path(temp_dir.name)
    suffix = Path(file.filename or "").suffix or ".bin"
    upload_path = temp_dir_path / f"upload{suffix}"
    normalized_path = temp_dir_path / "normalized.wav"

    audio_duration_seconds: float | None = None
    inference_time_seconds: float | None = None
    average_mos: float | None = None
    window_count: int | None = None
    peak_memory_gb: float | None = None
    delta_memory_gb: float | None = None
    resolved_window_seconds: float | None = None
    resolved_min_window_seconds: float | None = None

    try:
        (
            resolved_window_seconds,
            resolved_min_window_seconds,
        ) = _resolve_window_settings(
            window_seconds=window_seconds,
            min_window_seconds=min_window_seconds,
        )

        bytes_written = await _save_upload(file, upload_path)
        if bytes_written == 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Uploaded file is empty",
            )

        audio_duration_seconds = await run_in_threadpool(
            probe_audio_duration_seconds,
            upload_path,
        )
        await run_in_threadpool(normalize_audio_for_asr, upload_path, normalized_path)

        waveform, sample_rate = await run_in_threadpool(_read_waveform, normalized_path)
        windows = await run_in_threadpool(
            _build_windows,
            waveform,
            sample_rate=sample_rate,
            window_seconds=resolved_window_seconds,
        )
        windows = await run_in_threadpool(
            _merge_short_final_windows,
            windows,
            min_window_seconds=resolved_min_window_seconds,
        )
        assessor = await run_in_threadpool(get_quality_assessor)

        async with QUALITY_INFERENCE_SEMAPHORE:
            inference_started = time.perf_counter()
            async with MemorySampler(
                sample_interval_seconds=MEMORY_SAMPLE_INTERVAL_SECONDS
            ) as memory_sampler:
                quality_windows = await run_in_threadpool(
                    _assess_windows,
                    windows,
                    sample_rate=sample_rate,
                    assessor=assessor,
                )
            inference_time_seconds = time.perf_counter() - inference_started
            peak_memory_gb = memory_sampler.peak_memory_gb
            delta_memory_gb = memory_sampler.delta_memory_gb

        window_count = len(quality_windows)
        average_mos = _average_mos(quality_windows)
        response = QualityResponse(
            windows=quality_windows,
            average_mos=average_mos,
            inference_time_seconds=inference_time_seconds,
        )

        total_duration = time.perf_counter() - start_time
        _log_quality_status(
            status_value="success",
            duration_seconds=total_duration,
            audio_duration_seconds=audio_duration_seconds,
            inference_time_seconds=inference_time_seconds,
            window_count=window_count,
            average_mos=average_mos,
            peak_memory_gb=peak_memory_gb,
            delta_memory_gb=delta_memory_gb,
            window_seconds=resolved_window_seconds,
            min_window_seconds=resolved_min_window_seconds,
        )
        return response
    except AudioInputError as exc:
        total_duration = time.perf_counter() - start_time
        _log_quality_status(
            status_value="error",
            duration_seconds=total_duration,
            error=str(exc),
            audio_duration_seconds=audio_duration_seconds,
            peak_memory_gb=peak_memory_gb,
            delta_memory_gb=delta_memory_gb,
            window_seconds=resolved_window_seconds,
            min_window_seconds=resolved_min_window_seconds,
        )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc
    except AudioInfrastructureError as exc:
        total_duration = time.perf_counter() - start_time
        _log_quality_status(
            status_value="error",
            duration_seconds=total_duration,
            error=str(exc),
            audio_duration_seconds=audio_duration_seconds,
            peak_memory_gb=peak_memory_gb,
            delta_memory_gb=delta_memory_gb,
            window_seconds=resolved_window_seconds,
            min_window_seconds=resolved_min_window_seconds,
        )
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    except (QualityModelLoadError, ModuleNotFoundError) as exc:
        total_duration = time.perf_counter() - start_time
        _log_quality_status(
            status_value="error",
            duration_seconds=total_duration,
            error=str(exc),
            audio_duration_seconds=audio_duration_seconds,
            peak_memory_gb=peak_memory_gb,
            delta_memory_gb=delta_memory_gb,
            window_seconds=resolved_window_seconds,
            min_window_seconds=resolved_min_window_seconds,
        )
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    except QualityOutputError as exc:
        total_duration = time.perf_counter() - start_time
        _log_quality_status(
            status_value="error",
            duration_seconds=total_duration,
            error=str(exc),
            audio_duration_seconds=audio_duration_seconds,
            inference_time_seconds=inference_time_seconds,
            peak_memory_gb=peak_memory_gb,
            delta_memory_gb=delta_memory_gb,
            window_seconds=resolved_window_seconds,
            min_window_seconds=resolved_min_window_seconds,
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=str(exc),
        ) from exc
    except RuntimeError as exc:
        message = str(exc)
        if message in {
            "Input signal is too short.",
            "Maximum number of mel spectrogram windows exceeded. Use shorter audio.",
        }:
            total_duration = time.perf_counter() - start_time
            _log_quality_status(
                status_value="error",
                duration_seconds=total_duration,
                error=message,
                audio_duration_seconds=audio_duration_seconds,
                peak_memory_gb=peak_memory_gb,
                delta_memory_gb=delta_memory_gb,
                window_seconds=resolved_window_seconds,
                min_window_seconds=resolved_min_window_seconds,
            )
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=message,
            ) from exc
        total_duration = time.perf_counter() - start_time
        _log_quality_status(
            status_value="error",
            duration_seconds=total_duration,
            error=message,
            audio_duration_seconds=audio_duration_seconds,
            inference_time_seconds=inference_time_seconds,
            peak_memory_gb=peak_memory_gb,
            delta_memory_gb=delta_memory_gb,
            window_seconds=resolved_window_seconds,
            min_window_seconds=resolved_min_window_seconds,
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Quality assessment failed: {message}",
        ) from exc
    except HTTPException as exc:
        total_duration = time.perf_counter() - start_time
        _log_quality_status(
            status_value="error",
            duration_seconds=total_duration,
            error=exc.detail if isinstance(exc.detail, str) else str(exc.detail),
            audio_duration_seconds=audio_duration_seconds,
            inference_time_seconds=inference_time_seconds,
            window_count=window_count,
            average_mos=average_mos,
            peak_memory_gb=peak_memory_gb,
            delta_memory_gb=delta_memory_gb,
            window_seconds=resolved_window_seconds,
            min_window_seconds=resolved_min_window_seconds,
        )
        raise
    except Exception as exc:  # noqa: BLE001
        total_duration = time.perf_counter() - start_time
        _log_quality_status(
            status_value="error",
            duration_seconds=total_duration,
            error=str(exc),
            audio_duration_seconds=audio_duration_seconds,
            inference_time_seconds=inference_time_seconds,
            window_count=window_count,
            average_mos=average_mos,
            peak_memory_gb=peak_memory_gb,
            delta_memory_gb=delta_memory_gb,
            window_seconds=resolved_window_seconds,
            min_window_seconds=resolved_min_window_seconds,
        )
        logger.exception("Unexpected quality assessment error")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal quality assessment error",
        ) from exc
    finally:
        await file.close()
        temp_dir.cleanup()
