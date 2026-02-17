"""NISQA quality assessor loading and cache."""

from __future__ import annotations

import json
import logging
from collections.abc import Callable
from threading import Lock

from torch import Tensor

from app.config import NISQA_LABEL

logger = logging.getLogger("podcraft.ml")

QualityAssessor = Callable[[Tensor, int], Tensor]


class QualityModelLoadError(RuntimeError):
    """Raised when the quality assessor cannot be loaded."""


_assessor_lock = Lock()
_cached_assessor: QualityAssessor | None = None


def _load_quality_assessor() -> QualityAssessor:
    """Load the NISQA functional assessor from torchmetrics."""
    from torchmetrics.functional.audio.nisqa import (
        non_intrusive_speech_quality_assessment,
    )

    return non_intrusive_speech_quality_assessment


def get_quality_assessor() -> QualityAssessor:
    """Get the cached quality assessor, loading it lazily on first access."""
    global _cached_assessor  # noqa: PLW0603

    if _cached_assessor is not None:
        return _cached_assessor

    with _assessor_lock:
        if _cached_assessor is not None:
            return _cached_assessor

        logger.info(
            json.dumps(
                {
                    "event": "model_load_start",
                    "modelId": NISQA_LABEL,
                    "modelPath": "torchmetrics.functional.audio.nisqa",
                }
            )
        )
        try:
            assessor = _load_quality_assessor()
        except Exception as exc:  # noqa: BLE001
            logger.exception(
                json.dumps(
                    {
                        "event": "model_load_error",
                        "modelId": NISQA_LABEL,
                        "modelPath": "torchmetrics.functional.audio.nisqa",
                        "error": str(exc),
                    }
                )
            )
            raise QualityModelLoadError(f"Failed loading quality assessor: {exc}") from exc

        _cached_assessor = assessor
        logger.info(
            json.dumps(
                {
                    "event": "model_load_success",
                    "modelId": NISQA_LABEL,
                    "modelPath": "torchmetrics.functional.audio.nisqa",
                }
            )
        )

    return _cached_assessor


def reset_quality_assessor_cache() -> None:
    """Reset quality assessor cache (used by tests)."""
    global _cached_assessor  # noqa: PLW0603

    with _assessor_lock:
        _cached_assessor = None
