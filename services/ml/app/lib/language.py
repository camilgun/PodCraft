"""Language normalization utilities for ASR and TTS.

Single source of truth for language mappings.  Each model supports a
different subset — ASR covers 34 languages, TTS covers 10 — but all
aliases and ISO codes are resolved from the same master tables.
"""

from __future__ import annotations

# ---------------------------------------------------------------------------
# Master data — shared by ASR, TTS, and future models
# ---------------------------------------------------------------------------

# ISO code -> canonical English name (Title Case)
_LANGUAGE_CODE_TO_NAME: dict[str, str] = {
    "ar": "Arabic",
    "cs": "Czech",
    "da": "Danish",
    "de": "German",
    "el": "Greek",
    "en": "English",
    "es": "Spanish",
    "fa": "Persian",
    "fi": "Finnish",
    "fil": "Filipino",
    "fr": "French",
    "hi": "Hindi",
    "hu": "Hungarian",
    "id": "Indonesian",
    "it": "Italian",
    "ja": "Japanese",
    "ko": "Korean",
    "mk": "Macedonian",
    "ms": "Malay",
    "nl": "Dutch",
    "pl": "Polish",
    "pt": "Portuguese",
    "ro": "Romanian",
    "ru": "Russian",
    "sv": "Swedish",
    "th": "Thai",
    "tr": "Turkish",
    "vi": "Vietnamese",
    "yue": "Cantonese",
    "zh": "Chinese",
}

# Every known alias (lower-cased) -> ISO code.
# Includes ISO codes themselves, English names, and native-language aliases.
_LANGUAGE_ALIAS_TO_CODE: dict[str, str] = {
    "ar": "ar",
    "arabic": "ar",
    "cantonese": "yue",
    "chinese": "zh",
    "cs": "cs",
    "czech": "cs",
    "da": "da",
    "danish": "da",
    "de": "de",
    "deutsch": "de",
    "dutch": "nl",
    "el": "el",
    "en": "en",
    "english": "en",
    "es": "es",
    "fa": "fa",
    "fi": "fi",
    "finnish": "fi",
    "fil": "fil",
    "filipino": "fil",
    "fr": "fr",
    "french": "fr",
    "german": "de",
    "greek": "el",
    "hi": "hi",
    "hindi": "hi",
    "hu": "hu",
    "hungarian": "hu",
    "id": "id",
    "indonesian": "id",
    "it": "it",
    "italian": "it",
    "italiano": "it",
    "ja": "ja",
    "japanese": "ja",
    "ko": "ko",
    "korean": "ko",
    "macedonian": "mk",
    "malay": "ms",
    "mk": "mk",
    "ms": "ms",
    "nl": "nl",
    "pl": "pl",
    "polish": "pl",
    "portuguese": "pt",
    "pt": "pt",
    "ro": "ro",
    "romanian": "ro",
    "ru": "ru",
    "russian": "ru",
    "spanish": "es",
    "sv": "sv",
    "swedish": "sv",
    "th": "th",
    "thai": "th",
    "tr": "tr",
    "turkish": "tr",
    "vi": "vi",
    "vietnamese": "vi",
    "yue": "yue",
    "zh": "zh",
}

# ---------------------------------------------------------------------------
# Per-model supported subsets
# ---------------------------------------------------------------------------

_ASR_SUPPORTED_CODES: frozenset[str] = frozenset(_LANGUAGE_CODE_TO_NAME)

_TTS_SUPPORTED_CODES: frozenset[str] = frozenset(
    {"zh", "en", "de", "it", "pt", "es", "ja", "ko", "fr", "ru"}
)


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

def _alias_to_code(language: str) -> str | None:
    """Resolve a user-facing string to an ISO code, or ``None``."""
    return _LANGUAGE_ALIAS_TO_CODE.get(language.strip().lower())


# ---------------------------------------------------------------------------
# ASR-specific functions
# ---------------------------------------------------------------------------

def is_supported_asr_language_hint(language: str) -> bool:
    """Return whether *language* resolves to a code in the ASR model's set."""
    code = _alias_to_code(language)
    return code is not None and code in _ASR_SUPPORTED_CODES


def resolve_asr_prompt_language(
    language: str | None, *, default_language: str | None
) -> str | None:
    """Resolve request/default language hint to canonical prompt name expected by Qwen ASR."""
    explicit = (language or "").strip()
    fallback = (default_language or "").strip()
    selected = explicit or fallback
    if not selected:
        return None

    if selected.lower() == "unknown":
        return None

    code = _alias_to_code(selected)
    if code is None:
        return selected

    return _LANGUAGE_CODE_TO_NAME.get(code, selected)


def normalize_asr_response_language(language: str | None) -> str | None:
    """Normalize model/request language to a stable lower-case code for API responses."""
    value = (language or "").strip()
    if not value:
        return None

    lowered = value.lower()
    if lowered == "unknown":
        return "unknown"

    code = _LANGUAGE_ALIAS_TO_CODE.get(lowered)
    if code is not None:
        return code

    if len(lowered) in {2, 3} and lowered.isalpha():
        return lowered

    return None


# ---------------------------------------------------------------------------
# TTS-specific functions
# ---------------------------------------------------------------------------

def is_supported_tts_language(language: str) -> bool:
    """Return whether *language* resolves to a code in the TTS model's set."""
    code = _alias_to_code(language)
    return code is not None and code in _TTS_SUPPORTED_CODES


def resolve_tts_lang_code(language: str | None) -> str:
    """Resolve a user-facing language hint to a Qwen3-TTS ``lang_code``.

    Returns ``"auto"`` if *language* is ``None`` or empty.
    Raises ``ValueError`` if *language* is provided but not in the TTS set.
    """
    if language is None:
        return "auto"
    value = language.strip().lower()
    if not value:
        return "auto"

    code = _alias_to_code(value)
    if code is None or code not in _TTS_SUPPORTED_CODES:
        raise ValueError(f"Unsupported TTS language: {language}")

    # TTS model expects lowercase English name as lang_code
    return _LANGUAGE_CODE_TO_NAME[code].lower()
