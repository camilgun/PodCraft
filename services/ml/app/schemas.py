"""Pydantic schemas for the ML service API.

These mirror the Zod schemas in packages/shared where applicable.
"""

from pydantic import BaseModel, Field


class ModelStatus(BaseModel):
    """Status of a single ML model."""

    name: str = Field(description="Model identifier / directory name")
    available: bool = Field(description="Whether the model weights are present on disk")
    path: str = Field(description="Filesystem path where the model is expected")
    size_bytes: int | None = Field(
        default=None,
        description="Total size of model weight files in bytes, if available",
    )


class HealthResponse(BaseModel):
    """Response schema for GET /health."""

    status: str = Field(
        description="Service status: 'ok' if all models available, 'degraded' otherwise"
    )
    models: list[ModelStatus] = Field(description="Status of each required model")
    models_dir: str = Field(description="Base directory for model storage")
