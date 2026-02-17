"""Tests for TTS language utilities."""

from __future__ import annotations

import pytest

from app.lib.language import is_supported_tts_language, resolve_tts_lang_code


class TestIsSupportedTTSLanguage:
    def test_supported_iso_codes(self) -> None:
        for code in ("it", "en", "zh", "de", "fr", "es", "ja", "ko", "pt", "ru"):
            assert is_supported_tts_language(code) is True

    def test_supported_full_names(self) -> None:
        for name in (
            "Italian",
            "English",
            "Chinese",
            "German",
            "French",
            "Spanish",
            "Japanese",
            "Korean",
            "Portuguese",
            "Russian",
        ):
            assert is_supported_tts_language(name) is True

    def test_italiano_alias(self) -> None:
        assert is_supported_tts_language("italiano") is True

    def test_deutsch_alias(self) -> None:
        assert is_supported_tts_language("deutsch") is True

    def test_unsupported_language(self) -> None:
        assert is_supported_tts_language("Klingon") is False
        assert is_supported_tts_language("Finnish") is False
        assert is_supported_tts_language("Arabic") is False

    def test_case_insensitive(self) -> None:
        assert is_supported_tts_language("ITALIAN") is True
        assert is_supported_tts_language("italian") is True
        assert is_supported_tts_language("Italian") is True


class TestResolveTTSLangCode:
    def test_none_returns_auto(self) -> None:
        assert resolve_tts_lang_code(None) == "auto"

    def test_empty_returns_auto(self) -> None:
        assert resolve_tts_lang_code("") == "auto"
        assert resolve_tts_lang_code("   ") == "auto"

    def test_iso_code_resolves_to_model_lang_code(self) -> None:
        assert resolve_tts_lang_code("it") == "italian"
        assert resolve_tts_lang_code("en") == "english"
        assert resolve_tts_lang_code("zh") == "chinese"
        assert resolve_tts_lang_code("de") == "german"
        assert resolve_tts_lang_code("fr") == "french"

    def test_full_name_resolves_to_model_lang_code(self) -> None:
        assert resolve_tts_lang_code("Italian") == "italian"
        assert resolve_tts_lang_code("English") == "english"
        assert resolve_tts_lang_code("Japanese") == "japanese"

    def test_alias_resolves_to_model_lang_code(self) -> None:
        assert resolve_tts_lang_code("italiano") == "italian"
        assert resolve_tts_lang_code("deutsch") == "german"

    def test_unsupported_raises_value_error(self) -> None:
        with pytest.raises(ValueError, match="Unsupported TTS language"):
            resolve_tts_lang_code("Klingon")
