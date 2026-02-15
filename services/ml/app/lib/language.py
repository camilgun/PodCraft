"""Language normalization utilities for ASR hints and API responses."""

_ASR_LANGUAGE_CODE_TO_PROMPT: dict[str, str] = {
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

_ASR_LANGUAGE_ALIAS_TO_CODE: dict[str, str] = {
    "ar": "ar",
    "arabic": "ar",
    "cantonese": "yue",
    "chinese": "zh",
    "cs": "cs",
    "czech": "cs",
    "da": "da",
    "danish": "da",
    "de": "de",
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


def resolve_asr_prompt_language(
    language: str | None, *, default_language: str | None
) -> str | None:
    """Resolve request/default language hint to canonical prompt name expected by Qwen."""
    explicit = (language or "").strip()
    fallback = (default_language or "").strip()
    selected = explicit or fallback
    if not selected:
        return None

    if selected.lower() == "unknown":
        return None

    code = _ASR_LANGUAGE_ALIAS_TO_CODE.get(selected.lower())
    if code is None:
        return selected

    return _ASR_LANGUAGE_CODE_TO_PROMPT.get(code, selected)


def is_supported_asr_language_hint(language: str) -> bool:
    """Return whether a request language hint is supported by known aliases/codes."""
    value = language.strip().lower()
    return value in _ASR_LANGUAGE_ALIAS_TO_CODE


def normalize_asr_response_language(language: str | None) -> str | None:
    """Normalize model/request language to a stable lower-case code for API responses."""
    value = (language or "").strip()
    if not value:
        return None

    lowered = value.lower()
    if lowered == "unknown":
        return "unknown"

    code = _ASR_LANGUAGE_ALIAS_TO_CODE.get(lowered)
    if code is not None:
        return code

    if len(lowered) in {2, 3} and lowered.isalpha():
        return lowered

    return None
