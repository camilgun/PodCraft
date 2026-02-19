/** MOS score below which a segment is flagged as low quality (default). */
export const QUALITY_THRESHOLD_DEFAULT = 3.0;

/** Audio file formats supported by PodCraft. */
export const SUPPORTED_AUDIO_FORMATS = ["wav", "mp3", "m4a", "flac", "ogg"] as const;

/** Default base URL for the local ML service. */
export const ML_SERVICE_BASE_URL_DEFAULT = "http://localhost:5001";

/**
 * Number of bytes read from the start of an audio file to compute its
 * SHA-256 fingerprint. Combined with the total file size this produces a
 * fast, practically-unique identity for the file (used by Library Sync to
 * detect renames/moves without re-hashing the entire file).
 */
export const FILE_HASH_WINDOW_BYTES = 1024 * 1024; // 1 MB
