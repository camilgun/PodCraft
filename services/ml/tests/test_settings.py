"""Tests for settings validation."""

from pathlib import Path

import pytest
from pydantic import ValidationError

from app.config import Settings


def test_settings_accepts_supported_asr_default_language(tmp_path: Path) -> None:
    settings = Settings(hf_home=tmp_path / "models", asr_default_language=" Italian ")
    assert settings.asr_default_language == "Italian"


def test_settings_treats_blank_asr_default_language_as_none(tmp_path: Path) -> None:
    settings = Settings(hf_home=tmp_path / "models", asr_default_language="   ")
    assert settings.asr_default_language is None


def test_settings_rejects_unsupported_asr_default_language(tmp_path: Path) -> None:
    with pytest.raises(ValidationError, match="ASR_DEFAULT_LANGUAGE must be a supported"):
        Settings(hf_home=tmp_path / "models", asr_default_language="Klingon")
