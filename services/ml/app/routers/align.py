"""Forced alignment routes.

Long audio (> TRANSCRIPTION_CHUNK_SECONDS, default 240 s) is automatically split
into shorter chunks, each aligned independently, then merged with time offsets.
This works around the Qwen3-ForcedAligner-0.6B limitation of ≤ 5 min per pass.
"""

from __future__ import annotations

import asyncio
import json
import logging
import tempfile
import time
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, status
from pydantic import TypeAdapter, ValidationError
from starlette.concurrency import run_in_threadpool

from app.config import get_settings
from app.lib.audio import (
    AudioChunk,
    AudioInfrastructureError,
    AudioInputError,
    normalize_audio_for_asr,
    probe_audio_duration_seconds,
    split_audio_into_chunks,
)
from app.lib.chunking import TRANSCRIPTION_CHUNK_SECONDS
from app.lib.language import is_supported_asr_language_hint, resolve_asr_prompt_language
from app.lib.memory import MemorySampler
from app.models.aligner_model import AlignerLoadError, get_aligner_model
from app.schemas import AlignedWord, AlignResponse, TranscribeChunk

logger = logging.getLogger("podcraft.ml")

READ_CHUNK_SIZE = 1024 * 1024
ALIGN_MAX_CONCURRENT_INFERENCES = 1
MEMORY_SAMPLE_INTERVAL_SECONDS = 0.5
ALIGN_INFERENCE_SEMAPHORE = asyncio.Semaphore(ALIGN_MAX_CONCURRENT_INFERENCES)

TRANSCRIBE_CHUNKS_ADAPTER = TypeAdapter(list[TranscribeChunk])


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
    chunk_count: int | None = None,
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
        "chunk_count": chunk_count,
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


def _map_aligned_words(
    output: object,
    *,
    time_offset: float = 0.0,
) -> list[AlignedWord]:
    """Map model output to API response words, adding *time_offset* to every timestamp."""
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
                start_time=round(float(start_time) + time_offset, 4),
                end_time=round(float(end_time) + time_offset, 4),
            )
        )

    return words


# ── Chunked alignment helpers ─────────────────────────────────────────────


def _split_text_for_chunks(
    text: str,
    chunks: list[AudioChunk],
    total_duration: float,
) -> list[str]:
    """Split *text* into per-chunk substrings proportional to chunk duration.

    Words are allocated proportionally to each chunk's share of the total audio
    duration.  This is a rough heuristic — slight misalignment at chunk
    boundaries is acceptable because forced-alignment within each chunk will
    snap words to the correct audio position.
    """
    words = text.split()
    n_words = len(words)
    if n_words == 0:
        return [""] * len(chunks)

    result: list[str] = []
    word_index = 0

    for i, chunk in enumerate(chunks):
        if i == len(chunks) - 1:
            # Last chunk gets all remaining words
            chunk_words = words[word_index:]
        else:
            share = chunk.duration / total_duration if total_duration > 0 else 1.0 / len(chunks)
            n = max(1, round(n_words * share))
            chunk_words = words[word_index : word_index + n]
            word_index += n

        result.append(" ".join(chunk_words))

    return result


def _parse_transcribe_chunks(chunks_json: str | None) -> list[TranscribeChunk] | None:
    if chunks_json is None:
        return None

    try:
        raw_chunks = json.loads(chunks_json)
        chunks = TRANSCRIBE_CHUNKS_ADAPTER.validate_python(raw_chunks)
    except (json.JSONDecodeError, ValidationError) as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Field 'chunks_json' must be a valid TranscribeChunk[] JSON payload",
        ) from exc

    if not chunks:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Field 'chunks_json' must contain at least one chunk",
        )

    return chunks


def _align_single_chunk(
    model: object,
    chunk: AudioChunk,
    chunk_text: str,
    prompt_language: str,
) -> list[AlignedWord]:
    """Align a single audio chunk and return words with offset-adjusted timestamps."""
    if not chunk_text.strip():
        return []

    output = _generate_alignment(
        model,
        chunk.path,
        text=chunk_text,
        prompt_language=prompt_language,
    )
    return _map_aligned_words(output, time_offset=chunk.start_offset)


def _align_chunked_with_transcript_chunks(
    *,
    model: object,
    audio_chunks: list[AudioChunk],
    transcript_chunks: list[TranscribeChunk],
    prompt_language: str,
) -> list[AlignedWord]:
    if len(audio_chunks) != len(transcript_chunks):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Field 'chunks_json' chunk count does not match audio chunk count "
                f"({len(transcript_chunks)} != {len(audio_chunks)})"
            ),
        )

    all_words: list[AlignedWord] = []
    for chunk, transcript_chunk in zip(audio_chunks, transcript_chunks, strict=True):
        all_words.extend(
            _align_single_chunk(
                model,
                chunk,
                transcript_chunk.text,
                prompt_language,
            )
        )
    return all_words


router = APIRouter(tags=["align"])


@router.post("/align", response_model=AlignResponse)
async def align_audio(
    file: Annotated[UploadFile, File(...)],
    text: Annotated[str, Form(...)],
    language: Annotated[str | None, Form()] = None,
    chunks_json: Annotated[str | None, Form()] = None,
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
    chunk_count: int | None = None
    requested_language = language
    prompt_language: str | None = None

    try:
        transcript = text.strip()
        if not transcript:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Field 'text' must be a non-empty string",
            )
        transcript_chunks = _parse_transcribe_chunks(chunks_json)

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

        needs_chunking = audio_duration_seconds > TRANSCRIPTION_CHUNK_SECONDS

        async with ALIGN_INFERENCE_SEMAPHORE:
            inference_started = time.perf_counter()
            async with MemorySampler(
                sample_interval_seconds=MEMORY_SAMPLE_INTERVAL_SECONDS
            ) as memory_sampler:
                if needs_chunking:
                    # ── Chunked alignment for long audio ──────────────
                    chunks_dir = temp_dir_path / "chunks"
                    chunks_dir.mkdir()
                    audio_chunks = await run_in_threadpool(
                        split_audio_into_chunks,
                        normalized_path,
                        chunks_dir,
                        audio_duration_seconds,
                        TRANSCRIPTION_CHUNK_SECONDS,
                    )
                    chunk_count = len(audio_chunks)
                    if transcript_chunks is not None and len(transcript_chunks) != chunk_count:
                        raise HTTPException(
                            status_code=status.HTTP_400_BAD_REQUEST,
                            detail=(
                                "Field 'chunks_json' chunk count does not match audio chunk count "
                                f"({len(transcript_chunks)} != {chunk_count})"
                            ),
                        )
                    chunk_texts = (
                        None
                        if transcript_chunks is not None
                        else _split_text_for_chunks(
                            transcript,
                            audio_chunks,
                            audio_duration_seconds,
                        )
                    )

                    logger.info(
                        json.dumps({
                            "step": "align_chunked",
                            "chunk_count": chunk_count,
                            "audio_duration": audio_duration_seconds,
                            "chunk_seconds": TRANSCRIPTION_CHUNK_SECONDS,
                            "chunk_text_source": (
                                "transcribe_chunks"
                                if transcript_chunks is not None
                                else "duration_proportional"
                            ),
                        })
                    )

                    if transcript_chunks is not None:
                        for i, (chunk, transcript_chunk) in enumerate(
                            zip(audio_chunks, transcript_chunks, strict=True)
                        ):
                            logger.info(
                                json.dumps({
                                    "step": "align_chunk",
                                    "chunk_index": i,
                                    "chunk_offset": chunk.start_offset,
                                    "chunk_duration": chunk.duration,
                                    "chunk_word_count": len(transcript_chunk.text.split()),
                                })
                            )
                        words = await run_in_threadpool(
                            _align_chunked_with_transcript_chunks,
                            model=model,
                            audio_chunks=audio_chunks,
                            transcript_chunks=transcript_chunks,
                            prompt_language=prompt_language,
                        )
                    else:
                        all_words: list[AlignedWord] = []
                        for i, (chunk, chunk_text) in enumerate(
                            zip(audio_chunks, chunk_texts or [], strict=True)
                        ):
                            logger.info(
                                json.dumps({
                                    "step": "align_chunk",
                                    "chunk_index": i,
                                    "chunk_offset": chunk.start_offset,
                                    "chunk_duration": chunk.duration,
                                    "chunk_word_count": len(chunk_text.split()),
                                })
                            )
                            chunk_words = await run_in_threadpool(
                                _align_single_chunk,
                                model,
                                chunk,
                                chunk_text,
                                prompt_language,
                            )
                            all_words.extend(chunk_words)

                        words = all_words
                else:
                    # ── Single-pass alignment for short audio ─────────
                    chunk_count = 1
                    output = await run_in_threadpool(
                        _generate_alignment,
                        model,
                        normalized_path,
                        text=transcript,
                        prompt_language=prompt_language,
                    )
                    words = _map_aligned_words(output)

            inference_time_seconds = time.perf_counter() - inference_started
            peak_memory_gb = memory_sampler.peak_memory_gb
            delta_memory_gb = memory_sampler.delta_memory_gb

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
            chunk_count=chunk_count,
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
