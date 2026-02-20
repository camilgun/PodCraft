/**
 * Seed script — populates DB with deterministic test data without touching
 * non-seed rows by default.
 *
 * Usage:
 * - pnpm db:seed                 -> append mode (default, non-destructive)
 * - pnpm db:seed -- sync         -> update/replace seed rows only
 * - pnpm db:seed -- purge-seed   -> remove seed rows only
 */
import { inArray } from "drizzle-orm";
import type { AlignedSegment } from "@podcraft/shared";
import { analysisResults, qualityScores, recordings, transcriptions } from "./schema.js";

const SEED_MODES = ["append", "sync", "purge-seed"] as const;
type SeedMode = (typeof SEED_MODES)[number];

const now = new Date().toISOString();

const seedRecordingIds = {
  imported: "seed-rec-imported",
  transcribed: "seed-rec-transcribed",
  error: "seed-rec-error",
} as const;

const seedRecordingIdList = [
  seedRecordingIds.imported,
  seedRecordingIds.transcribed,
  seedRecordingIds.error,
] as const;

type RecordingInsert = typeof recordings.$inferInsert;
type TranscriptionInsert = typeof transcriptions.$inferInsert;
type QualityScoreInsert = typeof qualityScores.$inferInsert;

const segments: AlignedSegment[] = [
  {
    id: "seed-seg-001",
    text: "Ciao, oggi parliamo di intelligenza artificiale.",
    startTime: 0.5,
    endTime: 3.2,
    orderIndex: 0,
    words: [
      { word: "Ciao,", startTime: 0.5, endTime: 0.8, confidence: 0.97 },
      { word: "oggi", startTime: 0.9, endTime: 1.2, confidence: 0.95 },
      { word: "parliamo", startTime: 1.3, endTime: 1.8, confidence: 0.94 },
      { word: "di", startTime: 1.9, endTime: 2.0, confidence: 0.99 },
      { word: "intelligenza", startTime: 2.1, endTime: 2.7, confidence: 0.92 },
      { word: "artificiale.", startTime: 2.8, endTime: 3.2, confidence: 0.91 },
    ],
  },
  {
    id: "seed-seg-002",
    text: "È un tema che mi sta molto a cuore.",
    startTime: 3.8,
    endTime: 6.5,
    orderIndex: 1,
    words: [
      { word: "È", startTime: 3.8, endTime: 3.9, confidence: 0.88 },
      { word: "un", startTime: 4.0, endTime: 4.1, confidence: 0.99 },
      { word: "tema", startTime: 4.2, endTime: 4.6, confidence: 0.96 },
      { word: "che", startTime: 4.7, endTime: 4.9, confidence: 0.98 },
      { word: "mi", startTime: 5.0, endTime: 5.1, confidence: 0.99 },
      { word: "sta", startTime: 5.2, endTime: 5.4, confidence: 0.95 },
      { word: "molto", startTime: 5.5, endTime: 5.8, confidence: 0.93 },
      { word: "a", startTime: 5.9, endTime: 6.0, confidence: 0.99 },
      { word: "cuore.", startTime: 6.1, endTime: 6.5, confidence: 0.91 },
    ],
  },
];

const seedRecordings: RecordingInsert[] = [
  {
    id: seedRecordingIds.imported,
    filePath: "/Users/test/registrazioni/test_imported.m4a",
    originalFilename: "test_imported.m4a",
    durationSeconds: 742.5,
    sampleRate: 44100,
    channels: 1,
    format: "m4a",
    fileSizeBytes: 9_437_184,
    status: "IMPORTED",
    createdAt: now,
    updatedAt: now,
  },
  {
    id: seedRecordingIds.transcribed,
    filePath: "/Users/test/registrazioni/test_transcribed.wav",
    originalFilename: "test_transcribed.wav",
    durationSeconds: 120.0,
    sampleRate: 44100,
    channels: 2,
    format: "wav",
    fileSizeBytes: 21_168_000,
    status: "TRANSCRIBED",
    languageDetected: "it",
    createdAt: now,
    updatedAt: now,
  },
  {
    id: seedRecordingIds.error,
    filePath: "/Users/test/registrazioni/test_error.mp3",
    originalFilename: "test_error.mp3",
    durationSeconds: 300.0,
    sampleRate: 44100,
    channels: 2,
    format: "mp3",
    fileSizeBytes: 7_200_000,
    status: "ERROR",
    errorMessage: "ML service timeout after 120s — audio may be corrupted",
    createdAt: now,
    updatedAt: now,
  },
];

const seedTranscriptions: TranscriptionInsert[] = [
  {
    id: "seed-tx-001",
    recordingId: seedRecordingIds.transcribed,
    fullText: segments.map((segment) => segment.text).join(" "),
    segments: JSON.stringify(segments),
    modelUsed: "mlx-community/Qwen3-ASR-1.7B-bf16",
    languageDetected: "it",
    createdAt: now,
  },
];

const seedQualityScores: QualityScoreInsert[] = [
  {
    id: "seed-qs-001",
    recordingId: seedRecordingIds.transcribed,
    windowStart: 0,
    windowEnd: 3,
    mos: 4.1,
    noisiness: 3.8,
    discontinuity: 4.2,
    coloration: 4.0,
    loudness: 3.9,
    flagged: false,
    flaggedBy: "auto",
    createdAt: now,
  },
  {
    id: "seed-qs-002",
    recordingId: seedRecordingIds.transcribed,
    windowStart: 3,
    windowEnd: 6,
    mos: 2.4,
    noisiness: 2.1,
    discontinuity: 2.6,
    coloration: 2.3,
    loudness: 2.5,
    flagged: true,
    flaggedBy: "auto",
    createdAt: now,
  },
];

function isSeedMode(value: string): value is SeedMode {
  return SEED_MODES.some((mode) => mode === value);
}

function parseSeedMode(rawMode: string | undefined): SeedMode {
  if (!rawMode) {
    return "append";
  }

  const normalized = rawMode.startsWith("--mode=") ? rawMode.slice("--mode=".length) : rawMode;
  if (isSeedMode(normalized)) {
    return normalized;
  }

  throw new Error(`Invalid seed mode "${rawMode}". Use one of: ${SEED_MODES.join(", ")}.`);
}

async function purgeSeedRows(): Promise<void> {
  await db.delete(analysisResults).where(inArray(analysisResults.recordingId, seedRecordingIdList));
  await db.delete(qualityScores).where(inArray(qualityScores.recordingId, seedRecordingIdList));
  await db.delete(transcriptions).where(inArray(transcriptions.recordingId, seedRecordingIdList));
  await db.delete(recordings).where(inArray(recordings.id, seedRecordingIdList));
}

async function appendSeedRows(): Promise<void> {
  await db.insert(recordings).values(seedRecordings).onConflictDoNothing({ target: recordings.id });
  await db
    .insert(transcriptions)
    .values(seedTranscriptions)
    .onConflictDoNothing({ target: transcriptions.id });
  await db
    .insert(qualityScores)
    .values(seedQualityScores)
    .onConflictDoNothing({ target: qualityScores.id });
}

async function syncSeedRows(): Promise<void> {
  await purgeSeedRows();
  await db.insert(recordings).values(seedRecordings);
  await db.insert(transcriptions).values(seedTranscriptions);
  await db.insert(qualityScores).values(seedQualityScores);
}

if (process.env["NODE_ENV"] === "production") {
  throw new Error("Refusing to run db:seed in production (NODE_ENV=production).");
}

const seedMode = parseSeedMode(process.argv[2] ?? process.env["SEED_MODE"]);
const { db } = await import("./index.js");

switch (seedMode) {
  case "append":
    await appendSeedRows();
    break;
  case "sync":
    await syncSeedRows();
    break;
  case "purge-seed":
    await purgeSeedRows();
    break;
}

console.log(`✓ Seed mode "${seedMode}" completed:`);
console.log(`  - seed recordings: ${seedRecordings.length}`);
console.log(`  - seed transcription rows: ${seedTranscriptions.length}`);
console.log(`  - seed quality score rows: ${seedQualityScores.length}`);
