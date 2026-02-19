// ─── ML Service response types ────────────────────────────────────────────────
// These match the Python Pydantic schemas (snake_case fields).

export interface HealthResponse {
  status: "ok";
}

export interface TranscribeResponse {
  text: string;
  language: string;
  inference_time_seconds: number;
  audio_duration_seconds: number;
  model_used: string;
}

export interface MlAlignedWord {
  word: string;
  start_time: number;
  end_time: number;
}

export interface AlignResponse {
  words: MlAlignedWord[];
  inference_time_seconds: number;
  model_used: string;
}

export interface QualityWindow {
  window_start: number;
  window_end: number;
  mos: number;
  noisiness: number;
  discontinuity: number;
  coloration: number;
  loudness: number;
}

export interface QualityResponse {
  windows: QualityWindow[];
  average_mos: number;
  inference_time_seconds: number;
}

// ─── Domain types ─────────────────────────────────────────────────────────────
// These represent the app's internal data model (camelCase fields).

export type RecordingStatus =
  | "IMPORTED"
  | "TRANSCRIBING"
  | "TRANSCRIBED"
  | "ANALYZING"
  | "REVIEWED"
  | "EXPORTING"
  | "COMPLETED"
  | "ERROR"
  | "FILE_MISSING";

export interface Recording {
  id: string;
  filePath: string;
  originalFilename: string;
  /** SHA-256(first 1 MB of file + file_size_bytes) — canonical identity for reconciliation. */
  fileHash?: string | null;
  /** ISO 8601 timestamp of the last time the file's presence on disk was verified. */
  fileLastCheckedAt?: string | null;
  durationSeconds: number;
  sampleRate: number;
  channels: number;
  format: "wav" | "mp3" | "m4a" | "flac" | "ogg";
  fileSizeBytes: number;
  status: RecordingStatus;
  languageDetected?: string | null;
  errorMessage?: string | null;
  createdAt: string; // ISO 8601
  updatedAt: string;
}

export interface AlignedWord {
  word: string;
  startTime: number;
  endTime: number;
  confidence: number; // 0–1
}

export interface AlignedSegment {
  id: string;
  text: string;
  startTime: number;
  endTime: number;
  orderIndex: number;
  words: AlignedWord[];
}

export interface Transcription {
  id: string;
  recordingId: string;
  fullText: string;
  segments: AlignedSegment[];
  modelUsed: string;
  languageDetected: string;
  createdAt: string;
}

export interface QualityScore {
  id: string;
  recordingId: string;
  windowStart: number;
  windowEnd: number;
  mos: number; // 1.0–5.0
  noisiness: number;
  discontinuity: number;
  coloration: number;
  loudness: number;
  flagged: boolean;
  flaggedBy: "auto" | "user";
  createdAt: string;
}

export interface Chapter {
  title: string;
  startTime: number;
  endTime: number;
}

export interface EditProposal {
  id: string;
  analysisResultId: string;
  type: "cut" | "reorder" | "tts_replace";
  subtype?: "filler" | "repetition" | "off_topic" | "low_energy" | "tangent" | null;
  startTime: number;
  endTime: number;
  originalText: string;
  reason: string;
  confidence: number; // 0–1
  proposedPosition?: number | null; // solo per reorder
  status: "proposed" | "accepted" | "rejected" | "modified";
  userStartTime?: number | null;
  userEndTime?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface AnalysisResult {
  id: string;
  recordingId: string;
  summary: string;
  suggestedTitle: string;
  chapters: Chapter[];
  editorialNotes: string;
  proposals: EditProposal[];
  createdAt: string;
}
