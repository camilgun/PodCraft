"""PodCraft ML Service — FastAPI application."""

import logging
import sys
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path

from fastapi import FastAPI

from app.config import NISQA_LABEL, get_settings
from app.routers.align import router as align_router
from app.routers.asr import router as asr_router
from app.routers.quality import router as quality_router
from app.routers.tts import router as tts_router
from app.schemas import HealthResponse, ModelStatus

logger = logging.getLogger("podcraft.ml")

WEIGHT_EXTENSIONS = {".safetensors", ".bin", ".pt", ".gguf"}


def _check_model_availability(model_dir_name: str, hf_home: Path) -> ModelStatus:
    """Check if a model directory exists and contains weight files."""
    model_path = hf_home / model_dir_name

    if not model_path.exists():
        return ModelStatus(
            name=model_dir_name,
            available=False,
            path=str(model_path),
        )

    weight_files = [f for f in model_path.rglob("*") if f.suffix in WEIGHT_EXTENSIONS]
    total_size = sum(f.stat().st_size for f in weight_files)

    return ModelStatus(
        name=model_dir_name,
        available=len(weight_files) > 0,
        path=str(model_path),
        size_bytes=total_size if weight_files else None,
    )


def _check_nisqa_availability() -> ModelStatus:
    """Check NISQA availability (auto-downloads via torchmetrics on first use)."""
    try:
        version("torchmetrics")
        available = True
    except PackageNotFoundError:
        available = False

    return ModelStatus(
        name=NISQA_LABEL,
        available=available,
        path="torchmetrics (auto-download on first use)",
    )


def _configure_logging(log_level: str) -> None:
    """Configure structured logging for the ML service."""
    logging.basicConfig(
        level=getattr(logging, log_level.upper(), logging.INFO),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
        datefmt="%Y-%m-%dT%H:%M:%S",
        stream=sys.stdout,
    )


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncGenerator[None]:
    """Application lifespan: startup and shutdown logic."""
    settings = get_settings()
    _configure_logging(settings.log_level)
    settings.hf_home.mkdir(parents=True, exist_ok=True)

    logger.info("ML service starting — models dir: %s", settings.hf_home)
    yield
    logger.info("ML service shutting down")


app = FastAPI(
    title="PodCraft ML Service",
    version="0.1.0",
    lifespan=lifespan,
)
app.include_router(asr_router)
app.include_router(align_router)
app.include_router(tts_router)
app.include_router(quality_router)


@app.get("/health", response_model=HealthResponse)
async def health_check() -> HealthResponse:
    """Return service health and model availability status."""
    settings = get_settings()

    model_registry = settings.get_model_registry()
    models = [
        _check_model_availability(info.dir_name, settings.hf_home)
        for info in model_registry.values()
    ]
    models.append(_check_nisqa_availability())

    all_available = all(m.available for m in models)

    return HealthResponse(
        status="ok" if all_available else "degraded",
        models=models,
        models_dir=str(settings.hf_home),
    )
