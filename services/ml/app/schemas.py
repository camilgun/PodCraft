"""Pydantic schemas for the ML service API.

These mirror the Zod schemas in packages/shared where applicable.
"""

from pydantic import BaseModel, Field, model_validator


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


class TranscribeResponse(BaseModel):
    """Response schema for POST /transcribe."""

    text: str = Field(description="Full transcription text")
    language: str = Field(
        description=(
            "Normalized language code (ISO-like lower-case code such as 'it'/'en', "
            "or 'unknown')"
        ),
        pattern=r"^[a-z]{2,3}$|^unknown$",
    )
    inference_time_seconds: float = Field(
        description="Model inference latency in seconds",
        ge=0,
    )
    audio_duration_seconds: float = Field(
        description="Input audio duration in seconds",
        gt=0,
    )
    model_used: str = Field(description="Model identifier used for transcription")


class AlignedWord(BaseModel):
    """A single aligned word with start/end times in seconds."""

    word: str = Field(description="Aligned word")
    start_time: float = Field(
        description="Word start time in seconds",
        ge=0,
    )
    end_time: float = Field(
        description="Word end time in seconds",
        ge=0,
    )

    @model_validator(mode="after")
    def validate_timing(self) -> "AlignedWord":
        """Ensure timestamps are monotonic for each word."""
        if self.end_time < self.start_time:
            raise ValueError("end_time must be greater than or equal to start_time")
        return self


class AlignResponse(BaseModel):
    """Response schema for POST /align."""

    words: list[AlignedWord] = Field(description="Word-level aligned timestamps")
    inference_time_seconds: float = Field(
        description="Model inference latency in seconds",
        ge=0,
    )
    model_used: str = Field(description="Model identifier used for alignment")
