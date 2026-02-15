"""Application configuration via pydantic-settings.

Reads from environment variables and .env file at the monorepo root.
"""

from dataclasses import dataclass
from pathlib import Path

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def _find_monorepo_root() -> Path:
    """Walk up from this file to find the monorepo root (contains turbo.json)."""
    current = Path(__file__).resolve().parent
    for _ in range(10):
        current = current.parent
        if (current / "turbo.json").exists():
            return current
    return Path.cwd()


MONOREPO_ROOT = _find_monorepo_root()

NISQA_LABEL = "nisqa-v2.0"


@dataclass(frozen=True)
class ModelInfo:
    """Metadata for a single ML model."""

    repo_id: str
    dir_name: str


class Settings(BaseSettings):
    """PodCraft ML Service settings."""

    model_config = SettingsConfigDict(
        env_file=str(MONOREPO_ROOT / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    hf_home: Path = Field(
        default=Path.home() / ".podcraft" / "models",
        description="Directory where HuggingFace models are stored",
    )
    ml_host: str = Field(default="127.0.0.1", description="ML service bind host")
    ml_port: int = Field(default=5001, description="ML service bind port")
    log_level: str = Field(default="info", description="Logging level")

    # Model IDs — configurable to swap variants (e.g. bf16 → 8bit)
    asr_model_id: str = Field(default="mlx-community/Qwen3-ASR-1.7B-bf16")
    aligner_model_id: str = Field(default="mlx-community/Qwen3-ForcedAligner-0.6B-bf16")
    tts_model_id: str = Field(default="mlx-community/Qwen3-TTS-12Hz-1.7B-Base-bf16")

    @field_validator("hf_home", mode="before")
    @classmethod
    def expand_tilde(cls, v: str | Path) -> Path:
        return Path(str(v)).expanduser()

    def get_model_registry(self) -> dict[str, ModelInfo]:
        """Build model registry from current settings."""
        return {
            "asr": ModelInfo(
                repo_id=self.asr_model_id,
                dir_name=self.asr_model_id.split("/")[-1],
            ),
            "aligner": ModelInfo(
                repo_id=self.aligner_model_id,
                dir_name=self.aligner_model_id.split("/")[-1],
            ),
            "tts": ModelInfo(
                repo_id=self.tts_model_id,
                dir_name=self.tts_model_id.split("/")[-1],
            ),
        }


_settings: Settings | None = None


def get_settings() -> Settings:
    """Return cached Settings instance."""
    global _settings  # noqa: PLW0603
    if _settings is None:
        _settings = Settings()
    return _settings
