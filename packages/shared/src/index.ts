// ─── ML Service response types ────────────────────────────────────────────────
export type { HealthResponse } from "./types.js";
export type { TranscribeResponse } from "./types.js";
export type { MlAlignedWord } from "./types.js";
export type { AlignResponse } from "./types.js";
export type { QualityWindow } from "./types.js";
export type { QualityResponse } from "./types.js";

export {
  healthResponseSchema,
  transcribeResponseSchema,
  mlAlignedWordSchema,
  alignResponseSchema,
  qualityWindowSchema,
  qualityResponseSchema,
} from "./schemas.js";
export type {
  HealthResponseFromSchema,
  TranscribeResponseFromSchema,
  MlAlignedWordFromSchema,
  AlignResponseFromSchema,
  QualityWindowFromSchema,
  QualityResponseFromSchema,
} from "./schemas.js";

// ─── Domain types ─────────────────────────────────────────────────────────────
export type {
  RecordingStatus,
  Recording,
  LibrarySyncResponse,
  TranscribeStartResponse,
  AlignedWord,
  AlignedSegment,
  Transcription,
  QualityScore,
  Chapter,
  EditProposal,
  AnalysisResult,
} from "./types.js";

export {
  recordingStatusSchema,
  recordingSchema,
  recordingsListResponseSchema,
  recordingDetailResponseSchema,
  librarySyncResponseSchema,
  transcribeStartResponseSchema,
  alignedWordSchema,
  alignedSegmentSchema,
  transcriptionSchema,
  qualityScoreSchema,
  chapterSchema,
  editProposalSchema,
  analysisResultSchema,
} from "./schemas.js";
export type {
  RecordingStatusFromSchema,
  RecordingFromSchema,
  RecordingsListResponseFromSchema,
  RecordingDetailResponseFromSchema,
  LibrarySyncResponseFromSchema,
  TranscribeStartResponseFromSchema,
  AlignedWordFromSchema,
  AlignedSegmentFromSchema,
  TranscriptionFromSchema,
  QualityScoreFromSchema,
  ChapterFromSchema,
  EditProposalFromSchema,
  AnalysisResultFromSchema,
} from "./schemas.js";

// ─── State machine ────────────────────────────────────────────────────────────
export { canTransition, canStartTranscription, VALID_TRANSITIONS } from "./stateMachine.js";

// ─── Constants ────────────────────────────────────────────────────────────────
export {
  QUALITY_THRESHOLD_DEFAULT,
  SUPPORTED_AUDIO_FORMATS,
  ML_SERVICE_BASE_URL_DEFAULT,
  FILE_HASH_WINDOW_BYTES,
} from "./constants.js";
