"""Qwen3-TTS model loading and cache."""

from __future__ import annotations

import json
import logging
from pathlib import Path
from threading import Lock

from torch import nn

from app.config import Settings

logger = logging.getLogger("podcraft.ml")


class TTSLoadError(RuntimeError):
    """Raised when the TTS model cannot be loaded."""


_model_lock = Lock()
_cached_model: nn.Module | None = None
_cached_model_id: str | None = None


def _load_model(model_path: str) -> nn.Module:
    """Load the TTS model using mlx-audio."""
    from mlx_audio.tts.utils import load_model

    return load_model(model_path, lazy=True)


def _resolve_tts_model_path(settings: Settings) -> Path:
    """Resolve the local filesystem path for the TTS model."""
    tts_model_info = settings.get_model_registry()["tts"]
    return settings.hf_home / tts_model_info.dir_name


def get_tts_model(settings: Settings) -> nn.Module:
    """Get the cached TTS model, loading it lazily on first access."""
    global _cached_model  # noqa: PLW0603
    global _cached_model_id  # noqa: PLW0603

    if _cached_model is not None and _cached_model_id == settings.tts_model_id:
        return _cached_model

    with _model_lock:
        if _cached_model is not None and _cached_model_id == settings.tts_model_id:
            return _cached_model

        model_path = _resolve_tts_model_path(settings)
        if not model_path.exists():
            raise TTSLoadError(f"TTS model path not found: {model_path}")

        logger.info(
            json.dumps(
                {
                    "event": "model_load_start",
                    "modelId": settings.tts_model_id,
                    "modelPath": str(model_path),
                }
            )
        )

        try:
            model = _load_model(str(model_path))
        except Exception as exc:  # noqa: BLE001
            logger.exception(
                json.dumps(
                    {
                        "event": "model_load_error",
                        "modelId": settings.tts_model_id,
                        "modelPath": str(model_path),
                        "error": str(exc),
                    }
                )
            )
            raise TTSLoadError(f"Failed loading TTS model: {exc}") from exc

        _cached_model = model
        _cached_model_id = settings.tts_model_id
        logger.info(
            json.dumps(
                {
                    "event": "model_load_success",
                    "modelId": settings.tts_model_id,
                    "modelPath": str(model_path),
                }
            )
        )

    return _cached_model


def reset_tts_model_cache() -> None:
    """Reset TTS model cache (used by tests)."""
    global _cached_model  # noqa: PLW0603
    global _cached_model_id  # noqa: PLW0603

    with _model_lock:
        _cached_model = None
        _cached_model_id = None
