"""Tests for settings validation."""

from pathlib import Path

import pytest
from pydantic import ValidationError

from app.config import Settings


def test_settings_accepts_supported_asr_default_language(tmp_path: Path) -> None:
    settings = Settings(hf_home=tmp_path / "models", asr_default_language=" Italian ")
    assert settings.asr_default_language == "Italian"


def test_settings_rejects_blank_asr_default_language(tmp_path: Path) -> None:
    with pytest.raises(ValidationError, match="ASR_DEFAULT_LANGUAGE cannot be blank"):
        Settings(hf_home=tmp_path / "models", asr_default_language="   ")


def test_settings_rejects_unsupported_asr_default_language(tmp_path: Path) -> None:
    with pytest.raises(ValidationError, match="ASR_DEFAULT_LANGUAGE must be a supported"):
        Settings(hf_home=tmp_path / "models", asr_default_language="Klingon")


def test_settings_requires_asr_default_language(tmp_path: Path) -> None:
    with pytest.raises(ValidationError, match="asr_default_language"):
        Settings(hf_home=tmp_path / "models", _env_file=None)
