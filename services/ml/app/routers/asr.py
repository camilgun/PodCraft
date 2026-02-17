"""ASR routes."""

from __future__ import annotations

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
from app.lib.inference_limits import ASR_INFERENCE_SEMAPHORE
from app.lib.language import (
    is_supported_asr_language_hint,
    normalize_asr_response_language,
    resolve_asr_prompt_language,
)
from app.lib.memory import MemorySampler
from app.models.asr_model import ModelLoadError, get_asr_model
from app.schemas import TranscribeResponse

logger = logging.getLogger("podcraft.ml")

router = APIRouter(tags=["asr"])

READ_CHUNK_SIZE = 1024 * 1024
MEMORY_SAMPLE_INTERVAL_SECONDS = 0.5


def _log_transcribe_status(
    *,
    status_value: str,
    duration_seconds: float,
    error: str | None = None,
    audio_duration_seconds: float | None = None,
    inference_time_seconds: float | None = None,
    model_used: str | None = None,
    requested_language: str | None = None,
    prompt_language: str | None = None,
    peak_memory_gb: float | None = None,
    delta_memory_gb: float | None = None,
) -> None:
    payload = {
        "jobId": None,
        "recordingId": None,
        "step": "transcribe",
        "status": status_value,
        "duration": duration_seconds,
        "error": error,
        "audio_duration_seconds": audio_duration_seconds,
        "inference_time_seconds": inference_time_seconds,
        "model_used": model_used,
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


def _generate_transcript(
    model: object, audio_path: Path, *, prompt_language: str | None
) -> object:
    """Run ASR generation with stable kwargs."""
    generate_kwargs: dict[str, object] = {"verbose": False}
    if prompt_language is not None:
        generate_kwargs["language"] = prompt_language
    generate = getattr(model, "generate", None)
    if not callable(generate):
        raise RuntimeError("ASR model does not expose a callable generate method")
    return generate(str(audio_path), **generate_kwargs)


@router.post("/transcribe", response_model=TranscribeResponse)
async def transcribe_audio(
    file: Annotated[UploadFile, File(...)],
    language: Annotated[str | None, Form()] = None,
) -> TranscribeResponse:
    """Transcribe an uploaded audio file with Qwen3-ASR."""
    settings = get_settings()
    start_time = time.perf_counter()
    temp_dir = tempfile.TemporaryDirectory(prefix="podcraft-transcribe-")
    temp_dir_path = Path(temp_dir.name)
    suffix = Path(file.filename or "").suffix or ".bin"
    upload_path = temp_dir_path / f"upload{suffix}"
    normalized_path = temp_dir_path / "normalized.wav"
    audio_duration_seconds: float | None = None
    inference_time_seconds: float | None = None
    peak_memory_gb: float | None = None
    delta_memory_gb: float | None = None
    requested_language = language
    prompt_language: str | None = None

    try:
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

        prompt_language = resolve_asr_prompt_language(
            requested_language,
            default_language=settings.asr_default_language,
        )

        bytes_written = await _save_upload(file, upload_path)
        if bytes_written == 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Uploaded file is empty",
            )

        audio_duration_seconds = await run_in_threadpool(
            probe_audio_duration_seconds, upload_path
        )
        await run_in_threadpool(normalize_audio_for_asr, upload_path, normalized_path)
        model = await run_in_threadpool(get_asr_model, settings)

        async with ASR_INFERENCE_SEMAPHORE:
            inference_started = time.perf_counter()
            async with MemorySampler(
                sample_interval_seconds=MEMORY_SAMPLE_INTERVAL_SECONDS
            ) as memory_sampler:
                output = await run_in_threadpool(
                    _generate_transcript,
                    model,
                    normalized_path,
                    prompt_language=prompt_language,
                )
            inference_time_seconds = time.perf_counter() - inference_started
            peak_memory_gb = memory_sampler.peak_memory_gb
            delta_memory_gb = memory_sampler.delta_memory_gb

        text = output.text.strip()
        detected_language = normalize_asr_response_language(getattr(output, "language", None))
        hint_language = normalize_asr_response_language(prompt_language)
        response_language = detected_language or hint_language or "unknown"

        response = TranscribeResponse(
            text=text,
            language=response_language,
            inference_time_seconds=inference_time_seconds,
            audio_duration_seconds=audio_duration_seconds,
            model_used=settings.asr_model_id,
        )
        total_duration = time.perf_counter() - start_time
        _log_transcribe_status(
            status_value="success",
            duration_seconds=total_duration,
            audio_duration_seconds=audio_duration_seconds,
            inference_time_seconds=inference_time_seconds,
            model_used=settings.asr_model_id,
            requested_language=requested_language,
            prompt_language=prompt_language,
            peak_memory_gb=peak_memory_gb,
            delta_memory_gb=delta_memory_gb,
        )
        return response
    except AudioInputError as exc:
        total_duration = time.perf_counter() - start_time
        _log_transcribe_status(
            status_value="error",
            duration_seconds=total_duration,
            error=str(exc),
            audio_duration_seconds=audio_duration_seconds,
            model_used=settings.asr_model_id,
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
        _log_transcribe_status(
            status_value="error",
            duration_seconds=total_duration,
            error=str(exc),
            audio_duration_seconds=audio_duration_seconds,
            model_used=settings.asr_model_id,
            requested_language=requested_language,
            prompt_language=prompt_language,
            peak_memory_gb=peak_memory_gb,
            delta_memory_gb=delta_memory_gb,
        )
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    except ModelLoadError as exc:
        total_duration = time.perf_counter() - start_time
        _log_transcribe_status(
            status_value="error",
            duration_seconds=total_duration,
            error=str(exc),
            audio_duration_seconds=audio_duration_seconds,
            model_used=settings.asr_model_id,
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
        _log_transcribe_status(
            status_value="error",
            duration_seconds=total_duration,
            error=exc.detail if isinstance(exc.detail, str) else str(exc.detail),
            audio_duration_seconds=audio_duration_seconds,
            inference_time_seconds=inference_time_seconds,
            model_used=settings.asr_model_id,
            requested_language=requested_language,
            prompt_language=prompt_language,
            peak_memory_gb=peak_memory_gb,
            delta_memory_gb=delta_memory_gb,
        )
        raise
    except Exception as exc:  # noqa: BLE001
        total_duration = time.perf_counter() - start_time
        _log_transcribe_status(
            status_value="error",
            duration_seconds=total_duration,
            error=str(exc),
            audio_duration_seconds=audio_duration_seconds,
            inference_time_seconds=inference_time_seconds,
            model_used=settings.asr_model_id,
            requested_language=requested_language,
            prompt_language=prompt_language,
            peak_memory_gb=peak_memory_gb,
            delta_memory_gb=delta_memory_gb,
        )
        logger.exception("Unexpected transcription error")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal transcription error",
        ) from exc
    finally:
        await file.close()
        temp_dir.cleanup()
