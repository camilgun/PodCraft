"""Forced alignment routes."""

from __future__ import annotations

import asyncio
import json
import logging
import tempfile
import time
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, status
from starlette.concurrency import run_in_threadpool

from app.config import get_settings
from app.lib.audio import (
    AudioInfrastructureError,
    AudioInputError,
    normalize_audio_for_asr,
    probe_audio_duration_seconds,
)
from app.lib.language import is_supported_asr_language_hint, resolve_asr_prompt_language
from app.lib.memory import MemorySampler
from app.models.aligner_model import AlignerLoadError, get_aligner_model
from app.schemas import AlignedWord, AlignResponse

logger = logging.getLogger("podcraft.ml")

READ_CHUNK_SIZE = 1024 * 1024
ALIGN_MAX_CONCURRENT_INFERENCES = 1
MEMORY_SAMPLE_INTERVAL_SECONDS = 0.5
ALIGN_INFERENCE_SEMAPHORE = asyncio.Semaphore(ALIGN_MAX_CONCURRENT_INFERENCES)


def _log_align_status(
    *,
    status_value: str,
    duration_seconds: float,
    error: str | None = None,
    audio_duration_seconds: float | None = None,
    inference_time_seconds: float | None = None,
    model_used: str | None = None,
    word_count: int | None = None,
    requested_language: str | None = None,
    prompt_language: str | None = None,
    peak_memory_gb: float | None = None,
    delta_memory_gb: float | None = None,
) -> None:
    payload = {
        "jobId": None,
        "recordingId": None,
        "step": "align",
        "status": status_value,
        "duration": duration_seconds,
        "error": error,
        "audio_duration_seconds": audio_duration_seconds,
        "inference_time_seconds": inference_time_seconds,
        "model_used": model_used,
        "word_count": word_count,
        "requested_language": requested_language,
        "prompt_language": prompt_language,
        "peak_memory_gb": peak_memory_gb,
        "delta_memory_gb": delta_memory_gb,
    }
    logger.info(json.dumps(payload))


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


def _generate_alignment(
    model: object,
    audio_path: Path,
    *,
    text: str,
    prompt_language: str,
) -> object:
    """Run forced alignment using stable kwargs."""
    generate = getattr(model, "generate", None)
    if not callable(generate):
        raise RuntimeError("Aligner model does not expose a callable generate method")
    return generate(str(audio_path), text=text, language=prompt_language)


def _map_aligned_words(output: object) -> list[AlignedWord]:
    """Map model output to API response words."""
    raw_items = getattr(output, "items", None)
    if not isinstance(raw_items, list):
        raise RuntimeError("Aligner output does not contain an items list")

    words: list[AlignedWord] = []
    for item in raw_items:
        word = getattr(item, "text", None)
        start_time = getattr(item, "start_time", None)
        end_time = getattr(item, "end_time", None)

        if not isinstance(word, str):
            raise RuntimeError("Aligner output item has invalid text field")
        if not isinstance(start_time, (int, float)):
            raise RuntimeError("Aligner output item has invalid start_time field")
        if not isinstance(end_time, (int, float)):
            raise RuntimeError("Aligner output item has invalid end_time field")

        words.append(
            AlignedWord(
                word=word,
                start_time=float(start_time),
                end_time=float(end_time),
            )
        )

    return words


router = APIRouter(tags=["align"])


@router.post("/align", response_model=AlignResponse)
async def align_audio(
    file: Annotated[UploadFile, File(...)],
    text: Annotated[str, Form(...)],
    language: Annotated[str | None, Form()] = None,
) -> AlignResponse:
    """Generate word-level timestamps for an uploaded audio and transcript."""
    settings = get_settings()
    start_time = time.perf_counter()
    temp_dir = tempfile.TemporaryDirectory(prefix="podcraft-align-")
    temp_dir_path = Path(temp_dir.name)
    suffix = Path(file.filename or "").suffix or ".bin"
    upload_path = temp_dir_path / f"upload{suffix}"
    normalized_path = temp_dir_path / "normalized.wav"
    audio_duration_seconds: float | None = None
    inference_time_seconds: float | None = None
    peak_memory_gb: float | None = None
    delta_memory_gb: float | None = None
    word_count: int | None = None
    requested_language = language
    prompt_language: str | None = None

    try:
        transcript = text.strip()
        if not transcript:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Field 'text' must be a non-empty string",
            )

        if requested_language is not None:
            requested_language_hint = requested_language.strip()
            if (
                requested_language_hint
                and not is_supported_asr_language_hint(requested_language_hint)
            ):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Unsupported language hint: {requested_language_hint}",
                )

        prompt_language = (
            resolve_asr_prompt_language(
                requested_language,
                default_language=settings.asr_default_language,
            )
        )
        if prompt_language is None:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=(
                    "ASR_DEFAULT_LANGUAGE must be configured with a supported value"
                ),
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
        model = await run_in_threadpool(get_aligner_model, settings)

        async with ALIGN_INFERENCE_SEMAPHORE:
            inference_started = time.perf_counter()
            async with MemorySampler(
                sample_interval_seconds=MEMORY_SAMPLE_INTERVAL_SECONDS
            ) as memory_sampler:
                output = await run_in_threadpool(
                    _generate_alignment,
                    model,
                    normalized_path,
                    text=transcript,
                    prompt_language=prompt_language,
                )
            inference_time_seconds = time.perf_counter() - inference_started
            peak_memory_gb = memory_sampler.peak_memory_gb
            delta_memory_gb = memory_sampler.delta_memory_gb

        words = _map_aligned_words(output)
        word_count = len(words)

        response = AlignResponse(
            words=words,
            inference_time_seconds=inference_time_seconds,
            model_used=settings.aligner_model_id,
        )
        total_duration = time.perf_counter() - start_time
        _log_align_status(
            status_value="success",
            duration_seconds=total_duration,
            audio_duration_seconds=audio_duration_seconds,
            inference_time_seconds=inference_time_seconds,
            model_used=settings.aligner_model_id,
            word_count=word_count,
            requested_language=requested_language,
            prompt_language=prompt_language,
            peak_memory_gb=peak_memory_gb,
            delta_memory_gb=delta_memory_gb,
        )
        return response
    except AudioInputError as exc:
        total_duration = time.perf_counter() - start_time
        _log_align_status(
            status_value="error",
            duration_seconds=total_duration,
            error=str(exc),
            audio_duration_seconds=audio_duration_seconds,
            model_used=settings.aligner_model_id,
            requested_language=requested_language,
            prompt_language=prompt_language,
            peak_memory_gb=peak_memory_gb,
            delta_memory_gb=delta_memory_gb,
        )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc
    except AudioInfrastructureError as exc:
        total_duration = time.perf_counter() - start_time
        _log_align_status(
            status_value="error",
            duration_seconds=total_duration,
            error=str(exc),
            audio_duration_seconds=audio_duration_seconds,
            model_used=settings.aligner_model_id,
            requested_language=requested_language,
            prompt_language=prompt_language,
            peak_memory_gb=peak_memory_gb,
            delta_memory_gb=delta_memory_gb,
        )
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    except AlignerLoadError as exc:
        total_duration = time.perf_counter() - start_time
        _log_align_status(
            status_value="error",
            duration_seconds=total_duration,
            error=str(exc),
            audio_duration_seconds=audio_duration_seconds,
            model_used=settings.aligner_model_id,
            requested_language=requested_language,
            prompt_language=prompt_language,
            peak_memory_gb=peak_memory_gb,
            delta_memory_gb=delta_memory_gb,
        )
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    except HTTPException as exc:
        total_duration = time.perf_counter() - start_time
        _log_align_status(
            status_value="error",
            duration_seconds=total_duration,
            error=exc.detail if isinstance(exc.detail, str) else str(exc.detail),
            audio_duration_seconds=audio_duration_seconds,
            inference_time_seconds=inference_time_seconds,
            model_used=settings.aligner_model_id,
            word_count=word_count,
            requested_language=requested_language,
            prompt_language=prompt_language,
            peak_memory_gb=peak_memory_gb,
            delta_memory_gb=delta_memory_gb,
        )
        raise
    except Exception as exc:  # noqa: BLE001
        total_duration = time.perf_counter() - start_time
        _log_align_status(
            status_value="error",
            duration_seconds=total_duration,
            error=str(exc),
            audio_duration_seconds=audio_duration_seconds,
            inference_time_seconds=inference_time_seconds,
            model_used=settings.aligner_model_id,
            word_count=word_count,
            requested_language=requested_language,
            prompt_language=prompt_language,
            peak_memory_gb=peak_memory_gb,
            delta_memory_gb=delta_memory_gb,
        )
        logger.exception("Unexpected alignment error")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal alignment error",
        ) from exc
    finally:
        await file.close()
        temp_dir.cleanup()
