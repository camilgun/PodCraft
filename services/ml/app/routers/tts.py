"""TTS synthesis routes."""

from __future__ import annotations

import io
import json
import logging
import tempfile
import time
from pathlib import Path
from typing import Annotated

import numpy as np
import soundfile as sf
from fastapi import APIRouter, File, Form, HTTPException, UploadFile, status
from fastapi.responses import Response
from starlette.concurrency import run_in_threadpool

from app.config import get_settings
from app.lib.audio import (
    AudioInfrastructureError,
    AudioInputError,
    normalize_audio_for_asr,
    normalize_audio_for_tts_reference,
    probe_audio_duration_seconds,
)
from app.lib.inference_limits import ASR_INFERENCE_SEMAPHORE, TTS_INFERENCE_SEMAPHORE
from app.lib.language import (
    is_supported_tts_language,
    resolve_asr_prompt_language,
    resolve_tts_lang_code,
)
from app.lib.memory import MemorySampler
from app.models.asr_model import ModelLoadError, get_asr_model
from app.models.tts_model import TTSLoadError, get_tts_model

logger = logging.getLogger("podcraft.ml")

router = APIRouter(tags=["tts"])

READ_CHUNK_SIZE = 1024 * 1024
MEMORY_SAMPLE_INTERVAL_SECONDS = 0.5

MIN_REFERENCE_DURATION_SECONDS = 3.0
MAX_TEXT_LENGTH = 5000


def _log_synthesize_status(
    *,
    status_value: str,
    duration_seconds: float,
    error: str | None = None,
    text_length: int | None = None,
    reference_duration_seconds: float | None = None,
    inference_time_seconds: float | None = None,
    generated_audio_duration_seconds: float | None = None,
    model_used: str | None = None,
    language: str | None = None,
    peak_memory_gb: float | None = None,
    delta_memory_gb: float | None = None,
) -> None:
    payload = {
        "jobId": None,
        "recordingId": None,
        "step": "synthesize",
        "status": status_value,
        "duration": duration_seconds,
        "error": error,
        "text_length": text_length,
        "reference_duration_seconds": reference_duration_seconds,
        "inference_time_seconds": inference_time_seconds,
        "generated_audio_duration_seconds": generated_audio_duration_seconds,
        "model_used": model_used,
        "language": language,
        "peak_memory_gb": peak_memory_gb,
        "delta_memory_gb": delta_memory_gb,
    }
    logger.info(json.dumps(payload))


async def _save_upload(upload: UploadFile, destination: Path) -> int:
    """Save an uploaded file to *destination* and return bytes written."""
    total_bytes = 0
    with destination.open("wb") as output:
        while True:
            chunk = await upload.read(READ_CHUNK_SIZE)
            if not chunk:
                break
            output.write(chunk)
            total_bytes += len(chunk)
    return total_bytes


def _generate_speech(
    model: object,
    *,
    text: str,
    ref_audio_path: str,
    ref_text: str,
    lang_code: str,
) -> list[object]:
    """Run TTS generation and collect all result segments.

    Returns a list of ``GenerationResult`` objects from the model generator.
    Raises ``RuntimeError`` if no results are produced.
    """
    generate = getattr(model, "generate", None)
    if not callable(generate):
        raise RuntimeError("TTS model does not expose a callable generate method")

    results = list(
        generate(
            text=text,
            ref_audio=ref_audio_path,
            ref_text=ref_text,
            lang_code=lang_code,
            verbose=False,
        )
    )

    if not results:
        raise RuntimeError("TTS model produced no output")

    return results


def _transcribe_reference(
    asr_model: object,
    audio_path: Path,
    *,
    prompt_language: str | None,
) -> str:
    """Transcribe reference audio via the ASR model to obtain ``ref_text``."""
    generate_kwargs: dict[str, object] = {"verbose": False}
    if prompt_language is not None:
        generate_kwargs["language"] = prompt_language
    generate = getattr(asr_model, "generate", None)
    if not callable(generate):
        raise RuntimeError("ASR model does not expose a callable generate method")
    output = generate(str(audio_path), **generate_kwargs)
    text = getattr(output, "text", "")
    if not isinstance(text, str) or not text.strip():
        raise RuntimeError("ASR model produced empty transcript for reference audio")
    return text.strip()


def _encode_audio_to_wav_bytes(audio_array: np.ndarray, sample_rate: int) -> bytes:
    """Encode a 1-D float audio waveform to PCM-16 WAV bytes."""
    audio = audio_array.astype(np.float32)
    if audio.ndim > 1:
        audio = audio.flatten()

    # Normalize to [-1, 1] to prevent clipping
    max_val = np.abs(audio).max()
    if max_val > 1.0:
        audio = audio / max_val

    buf = io.BytesIO()
    sf.write(buf, audio, sample_rate, format="WAV", subtype="PCM_16")
    buf.seek(0)
    return buf.getvalue()


@router.post("/synthesize")
async def synthesize_audio(
    text: Annotated[str, Form(...)],
    reference_audio: Annotated[UploadFile, File(...)],
    reference_text: Annotated[str | None, Form()] = None,
    language: Annotated[str | None, Form()] = None,
) -> Response:
    """Synthesize speech from text using voice cloning from reference audio.

    Returns WAV audio binary with metrics in response headers.
    """
    settings = get_settings()
    start_time = time.perf_counter()
    temp_dir = tempfile.TemporaryDirectory(prefix="podcraft-synthesize-")
    temp_dir_path = Path(temp_dir.name)
    suffix = Path(reference_audio.filename or "").suffix or ".bin"
    upload_path = temp_dir_path / f"upload{suffix}"
    normalized_ref_path = temp_dir_path / "reference.wav"

    reference_duration_seconds: float | None = None
    inference_time_seconds: float | None = None
    generated_audio_duration_seconds: float | None = None
    peak_memory_gb: float | None = None
    delta_memory_gb: float | None = None
    text_length: int | None = None
    lang_code: str | None = None
    reference_text_source = "explicit"

    try:
        # ── Validate text ───────────────────────────────────────────
        synthesis_text = text.strip()
        if not synthesis_text:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Field 'text' must be a non-empty string",
            )
        text_length = len(synthesis_text)
        if text_length > MAX_TEXT_LENGTH:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Text exceeds maximum length of {MAX_TEXT_LENGTH} characters",
            )

        # ── Validate reference_text (optional — auto-transcribed if missing)
        ref_text = (reference_text or "").strip()

        # ── Validate and resolve language ───────────────────────────
        if language is not None:
            language_hint = language.strip()
            if language_hint and not is_supported_tts_language(language_hint):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Unsupported TTS language: {language_hint}",
                )

        try:
            lang_code = resolve_tts_lang_code(language)
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=str(exc),
            ) from exc

        # ── Save and validate reference audio ───────────────────────
        bytes_written = await _save_upload(reference_audio, upload_path)
        if bytes_written == 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Uploaded reference audio file is empty",
            )

        reference_duration_seconds = await run_in_threadpool(
            probe_audio_duration_seconds, upload_path
        )

        if reference_duration_seconds < MIN_REFERENCE_DURATION_SECONDS:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"Reference audio is too short ({reference_duration_seconds:.1f}s). "
                    f"Minimum {MIN_REFERENCE_DURATION_SECONDS}s required."
                ),
            )

        # ── Normalize reference audio ───────────────────────────────
        await run_in_threadpool(
            normalize_audio_for_tts_reference, upload_path, normalized_ref_path
        )

        # ── Auto-transcribe reference if reference_text not provided ─
        if not ref_text:
            asr_normalized_path = temp_dir_path / "asr_normalized.wav"
            await run_in_threadpool(
                normalize_audio_for_asr, upload_path, asr_normalized_path
            )
            async with ASR_INFERENCE_SEMAPHORE:
                asr_model = await run_in_threadpool(get_asr_model, settings)
                asr_prompt_language = resolve_asr_prompt_language(
                    language, default_language=settings.asr_default_language
                )
                ref_text = await run_in_threadpool(
                    _transcribe_reference,
                    asr_model,
                    asr_normalized_path,
                    prompt_language=asr_prompt_language,
                )
            reference_text_source = "auto_asr"

        logger.info(
            json.dumps(
                {
                    "event": "reference_text_resolved",
                    "step": "synthesize",
                    "reference_text_source": reference_text_source,
                    "reference_text_chars": len(ref_text),
                    "reference_text_words": len(ref_text.split()),
                    "reference_audio_duration_seconds": reference_duration_seconds,
                    "language": lang_code,
                }
            )
        )

        # ── Load model ──────────────────────────────────────────────
        model = await run_in_threadpool(get_tts_model, settings)

        # ── Run inference ───────────────────────────────────────────
        async with TTS_INFERENCE_SEMAPHORE:
            inference_started = time.perf_counter()
            async with MemorySampler(
                sample_interval_seconds=MEMORY_SAMPLE_INTERVAL_SECONDS
            ) as memory_sampler:
                results = await run_in_threadpool(
                    _generate_speech,
                    model,
                    text=synthesis_text,
                    ref_audio_path=str(normalized_ref_path),
                    ref_text=ref_text,
                    lang_code=lang_code,
                )
            inference_time_seconds = time.perf_counter() - inference_started
            peak_memory_gb = memory_sampler.peak_memory_gb
            delta_memory_gb = memory_sampler.delta_memory_gb

        # ── Combine audio segments ──────────────────────────────────
        audio_parts: list[np.ndarray] = []
        sample_rate: int | None = None
        for result in results:
            audio = getattr(result, "audio", None)
            sr = getattr(result, "sample_rate", None)
            if audio is None or sr is None:
                raise RuntimeError("TTS result missing audio or sample_rate")
            audio_parts.append(np.array(audio, dtype=np.float32))
            if sample_rate is None:
                sample_rate = int(sr)

        if not audio_parts or sample_rate is None:
            raise RuntimeError("TTS produced no audio data")

        combined_audio = np.concatenate(audio_parts)
        generated_audio_duration_seconds = float(len(combined_audio)) / sample_rate

        # ── Encode to WAV ───────────────────────────────────────────
        wav_bytes = await run_in_threadpool(
            _encode_audio_to_wav_bytes, combined_audio, sample_rate
        )

        total_duration = time.perf_counter() - start_time
        _log_synthesize_status(
            status_value="success",
            duration_seconds=total_duration,
            text_length=text_length,
            reference_duration_seconds=reference_duration_seconds,
            inference_time_seconds=inference_time_seconds,
            generated_audio_duration_seconds=generated_audio_duration_seconds,
            model_used=settings.tts_model_id,
            language=lang_code,
            peak_memory_gb=peak_memory_gb,
            delta_memory_gb=delta_memory_gb,
        )

        return Response(
            content=wav_bytes,
            media_type="audio/wav",
            headers={
                "X-Inference-Time-Seconds": f"{inference_time_seconds:.3f}",
                "X-Audio-Duration-Seconds": f"{generated_audio_duration_seconds:.3f}",
                "X-Model-Used": settings.tts_model_id,
                "X-Peak-Memory-GB": (
                    f"{peak_memory_gb:.3f}" if peak_memory_gb is not None else "0"
                ),
                "X-Delta-Memory-GB": (
                    f"{delta_memory_gb:.3f}" if delta_memory_gb is not None else "0"
                ),
            },
        )
    except AudioInputError as exc:
        total_duration = time.perf_counter() - start_time
        _log_synthesize_status(
            status_value="error",
            duration_seconds=total_duration,
            error=str(exc),
            text_length=text_length,
            reference_duration_seconds=reference_duration_seconds,
            model_used=settings.tts_model_id,
            language=lang_code,
            peak_memory_gb=peak_memory_gb,
            delta_memory_gb=delta_memory_gb,
        )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc
    except AudioInfrastructureError as exc:
        total_duration = time.perf_counter() - start_time
        _log_synthesize_status(
            status_value="error",
            duration_seconds=total_duration,
            error=str(exc),
            text_length=text_length,
            reference_duration_seconds=reference_duration_seconds,
            model_used=settings.tts_model_id,
            language=lang_code,
            peak_memory_gb=peak_memory_gb,
            delta_memory_gb=delta_memory_gb,
        )
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    except (TTSLoadError, ModelLoadError) as exc:
        total_duration = time.perf_counter() - start_time
        _log_synthesize_status(
            status_value="error",
            duration_seconds=total_duration,
            error=str(exc),
            text_length=text_length,
            reference_duration_seconds=reference_duration_seconds,
            model_used=settings.tts_model_id,
            language=lang_code,
            peak_memory_gb=peak_memory_gb,
            delta_memory_gb=delta_memory_gb,
        )
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    except HTTPException as exc:
        total_duration = time.perf_counter() - start_time
        _log_synthesize_status(
            status_value="error",
            duration_seconds=total_duration,
            error=exc.detail if isinstance(exc.detail, str) else str(exc.detail),
            text_length=text_length,
            reference_duration_seconds=reference_duration_seconds,
            inference_time_seconds=inference_time_seconds,
            model_used=settings.tts_model_id,
            language=lang_code,
            peak_memory_gb=peak_memory_gb,
            delta_memory_gb=delta_memory_gb,
        )
        raise
    except Exception as exc:  # noqa: BLE001
        total_duration = time.perf_counter() - start_time
        _log_synthesize_status(
            status_value="error",
            duration_seconds=total_duration,
            error=str(exc),
            text_length=text_length,
            reference_duration_seconds=reference_duration_seconds,
            inference_time_seconds=inference_time_seconds,
            model_used=settings.tts_model_id,
            language=lang_code,
            peak_memory_gb=peak_memory_gb,
            delta_memory_gb=delta_memory_gb,
        )
        logger.exception("Unexpected synthesis error")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal synthesis error",
        ) from exc
    finally:
        await reference_audio.close()
        temp_dir.cleanup()
