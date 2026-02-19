import { Hono } from "hono";
import { eq } from "drizzle-orm";
import {
  canTransition,
  recordingDetailResponseSchema,
  recordingsListResponseSchema
} from "@podcraft/shared";
import type { Recording } from "@podcraft/shared";
import { db } from "../db/index.js";
import { recordings } from "../db/schema.js";

const app = new Hono();
const TRANSCRIBE_STARTABLE_STATUSES: ReadonlySet<Recording["status"]> = new Set([
  "IMPORTED",
  "TRANSCRIBED",
  "ERROR"
]);

/** Maps a Drizzle row to the Recording domain type. */
function rowToRecording(row: typeof recordings.$inferSelect): Recording {
  return {
    id: row.id,
    filePath: row.filePath,
    originalFilename: row.originalFilename,
    fileHash: row.fileHash,
    fileLastCheckedAt: row.fileLastCheckedAt,
    durationSeconds: row.durationSeconds,
    sampleRate: row.sampleRate,
    channels: row.channels,
    format: row.format as Recording["format"],
    fileSizeBytes: row.fileSizeBytes,
    status: row.status as Recording["status"],
    languageDetected: row.languageDetected,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

/** GET /api/recordings — list all recordings ordered by creation date */
app.get("/api/recordings", async (c) => {
  const rows = await db.select().from(recordings).orderBy(recordings.createdAt);

  const payload = { recordings: rows.map(rowToRecording) };
  const validated = recordingsListResponseSchema.safeParse(payload);
  if (!validated.success) {
    console.error("[recordings] Invalid recordings list payload:", validated.error.message);
    return c.json({ error: "Internal error: invalid recordings data" }, 500);
  }

  return c.json(validated.data);
});

/** GET /api/recordings/:id — single recording detail */
app.get("/api/recordings/:id", async (c) => {
  const id = c.req.param("id");
  const rows = await db.select().from(recordings).where(eq(recordings.id, id)).limit(1);

  if (rows.length === 0) {
    return c.json({ error: "Recording not found" }, 404);
  }

  const recording = rowToRecording(rows[0]!);
  const validated = recordingDetailResponseSchema.safeParse({ recording });
  if (!validated.success) {
    console.error(`[recordings] Invalid recording data for id=${id}:`, validated.error.message);
    return c.json({ error: "Internal error: invalid recording data" }, 500);
  }

  return c.json(validated.data);
});

/**
 * POST /api/recordings/:id/transcribe — start transcription (placeholder).
 * Returns 202 Accepted. Actual job enqueue comes in Task 1.10.
 */
app.post("/api/recordings/:id/transcribe", async (c) => {
  const id = c.req.param("id");
  const rows = await db.select().from(recordings).where(eq(recordings.id, id)).limit(1);

  if (rows.length === 0) {
    return c.json({ error: "Recording not found" }, 404);
  }

  const row = rows[0]!;
  const currentStatus = row.status as Recording["status"];
  const nextStatus: Recording["status"] = "TRANSCRIBING";

  // Idempotency: if transcription is already in progress, return 202 without re-triggering.
  if (currentStatus === nextStatus) {
    return c.json({ status: "already_in_progress", recordingId: id }, 202);
  }

  // Action-level guard: do not rely on generic state-machine transitions for API intent.
  if (!TRANSCRIBE_STARTABLE_STATUSES.has(currentStatus)) {
    return c.json(
      {
        error: `Cannot start transcription from status "${currentStatus}"`,
        currentStatus
      },
      409
    );
  }

  // Defensive check: ensure declared startable statuses remain consistent with the state machine.
  if (!canTransition(currentStatus, nextStatus)) {
    return c.json(
      {
        error: `Cannot start transcription from status "${currentStatus}"`,
        currentStatus
      },
      409
    );
  }

  // Placeholder — job enqueue will be added in Task 1.10
  return c.json({ status: "accepted", recordingId: id }, 202);
});

export default app;
