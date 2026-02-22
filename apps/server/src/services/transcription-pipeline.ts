import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { recordings, transcriptions } from "../db/schema.js";
import { mlTranscribe, mlAlign } from "../lib/ml-client.js";
import { groupWordsIntoSegments } from "../lib/segment-grouper.js";

export { groupWordsIntoSegments } from "../lib/segment-grouper.js";
export type { GroupWordsOptions } from "../lib/segment-grouper.js";

// ─── Pipeline ─────────────────────────────────────────────────────────────

function nowIso(): string {
  return new Date().toISOString();
}

async function setRecordingError(recordingId: string, message: string): Promise<void> {
  await db
    .update(recordings)
    .set({ status: "ERROR", errorMessage: message, updatedAt: nowIso() })
    .where(eq(recordings.id, recordingId));
}

/**
 * Runs the full transcription pipeline for a recording:
 *   1. ASR  (ML /transcribe)
 *   2. Alignment (ML /align)
 *   3. Segment grouping
 *   4. Persist Transcription to DB
 *   5. Update recording status → TRANSCRIBED
 *
 * Called by the BullMQ Worker. Sets recording to ERROR on any failure.
 */
export async function runTranscriptionPipeline(recordingId: string): Promise<void> {
  const start = Date.now();

  // 1. Fetch recording
  const rows = await db
    .select()
    .from(recordings)
    .where(eq(recordings.id, recordingId))
    .limit(1);

  if (rows.length === 0) {
    console.error(
      JSON.stringify({ recordingId, step: "fetch", status: "error", error: "Recording not found" }),
    );
    return;
  }

  const row = rows[0]!;
  const filePath = row.filePath;
  const language = row.languageDetected ?? undefined;

  // 2. Mark as TRANSCRIBING
  await db
    .update(recordings)
    .set({ status: "TRANSCRIBING", errorMessage: null, updatedAt: nowIso() })
    .where(eq(recordings.id, recordingId));

  console.log(JSON.stringify({ recordingId, step: "transcribing_started", status: "ok" }));

  // 3. ASR
  const asrStart = Date.now();
  const asrResult = await mlTranscribe(filePath, language);
  if (!asrResult.ok) {
    console.error(
      JSON.stringify({
        recordingId,
        step: "asr",
        status: "error",
        error: asrResult.error,
        durationMs: Date.now() - asrStart,
      }),
    );
    await setRecordingError(recordingId, `ASR failed: ${asrResult.error}`);
    return;
  }

  console.log(
    JSON.stringify({
      recordingId,
      step: "asr",
      status: "ok",
      durationMs: Date.now() - asrStart,
      language: asrResult.data.language,
    }),
  );

  // 4. Alignment
  const alignStart = Date.now();
  const alignResult = await mlAlign(filePath, asrResult.data.text, asrResult.data.language);
  if (!alignResult.ok) {
    console.error(
      JSON.stringify({
        recordingId,
        step: "align",
        status: "error",
        error: alignResult.error,
        durationMs: Date.now() - alignStart,
      }),
    );
    await setRecordingError(recordingId, `Alignment failed: ${alignResult.error}`);
    return;
  }

  console.log(
    JSON.stringify({
      recordingId,
      step: "align",
      status: "ok",
      durationMs: Date.now() - alignStart,
      wordCount: alignResult.data.words.length,
    }),
  );

  // 5. Group words into segments
  const segments = groupWordsIntoSegments(alignResult.data.words);

  // 6. Persist to DB (transaction: delete old, insert new, update recording)
  const transcriptionId = randomUUID();
  const createdAt = nowIso();

  db.transaction((tx) => {
    // Delete any existing transcription for this recording (idempotent re-transcribe)
    tx.delete(transcriptions).where(eq(transcriptions.recordingId, recordingId)).run();

    tx.insert(transcriptions)
      .values({
        id: transcriptionId,
        recordingId,
        fullText: asrResult.data.text,
        segments: JSON.stringify(segments),
        modelUsed: asrResult.data.model_used,
        languageDetected: asrResult.data.language,
        createdAt,
      })
      .run();

    tx.update(recordings)
      .set({
        status: "TRANSCRIBED",
        languageDetected: asrResult.data.language,
        errorMessage: null,
        updatedAt: createdAt,
      })
      .where(eq(recordings.id, recordingId))
      .run();
  });

  console.log(
    JSON.stringify({
      recordingId,
      step: "persisted",
      status: "ok",
      transcriptionId,
      segmentCount: segments.length,
      totalDurationMs: Date.now() - start,
    }),
  );
}
