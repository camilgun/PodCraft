"""Tests for ASR language normalization."""

from app.lib.language import (
    is_supported_asr_language_hint,
    normalize_asr_response_language,
    resolve_asr_prompt_language,
)


def test_resolve_asr_prompt_language_uses_default_when_missing() -> None:
    resolved = resolve_asr_prompt_language(None, default_language="Italian")
    assert resolved == "Italian"


def test_resolve_asr_prompt_language_returns_none_when_missing_and_no_default() -> None:
    resolved = resolve_asr_prompt_language(None, default_language=None)
    assert resolved is None


def test_resolve_asr_prompt_language_maps_iso_alias() -> None:
    resolved = resolve_asr_prompt_language("it", default_language="English")
    assert resolved == "Italian"


def test_resolve_asr_prompt_language_preserves_unknown_values() -> None:
    resolved = resolve_asr_prompt_language("Klingon", default_language="English")
    assert resolved == "Klingon"


def test_is_supported_asr_language_hint_accepts_known_alias() -> None:
    assert is_supported_asr_language_hint("Italian") is True


def test_is_supported_asr_language_hint_rejects_unknown_alias() -> None:
    assert is_supported_asr_language_hint("Klingon") is False


def test_normalize_asr_response_language_maps_prompt_name_to_code() -> None:
    normalized = normalize_asr_response_language("Italian")
    assert normalized == "it"


def test_normalize_asr_response_language_preserves_known_code() -> None:
    normalized = normalize_asr_response_language("en")
    assert normalized == "en"


def test_normalize_asr_response_language_returns_none_for_unmappable_values() -> None:
    normalized = normalize_asr_response_language("Klingon")
    assert normalized is None
