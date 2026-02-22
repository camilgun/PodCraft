import { Hono } from "hono";
import { desc, eq } from "drizzle-orm";
import { transcriptionDetailResponseSchema } from "@podcraft/shared";
import { db } from "../db/index.js";
import { recordings, transcriptions } from "../db/schema.js";

const app = new Hono();

/** GET /api/recordings/:id/transcription — fetch the transcription for a recording. */
app.get("/api/recordings/:id/transcription", async (c) => {
  const id = c.req.param("id");

  // Verify the recording exists
  const recordingRows = await db
    .select({ id: recordings.id })
    .from(recordings)
    .where(eq(recordings.id, id))
    .limit(1);

  if (recordingRows.length === 0) {
    return c.json({ error: "Recording not found" }, 404);
  }

  const rows = await db
    .select()
    .from(transcriptions)
    .where(eq(transcriptions.recordingId, id))
    .orderBy(desc(transcriptions.createdAt), desc(transcriptions.id))
    .limit(1);

  if (rows.length === 0) {
    return c.json({ error: "Transcription not available" }, 404);
  }

  const row = rows[0]!;

  let segments: unknown;
  try {
    segments = JSON.parse(row.segments) as unknown;
  } catch {
    console.error(`[transcription] Failed to parse segments JSON for recordingId=${id}`);
    return c.json({ error: "Internal error: corrupt segments data" }, 500);
  }

  const payload = {
    transcription: {
      id: row.id,
      recordingId: row.recordingId,
      fullText: row.fullText,
      segments,
      modelUsed: row.modelUsed,
      languageDetected: row.languageDetected,
      createdAt: row.createdAt,
    },
  };

  const validated = transcriptionDetailResponseSchema.safeParse(payload);
  if (!validated.success) {
    console.error(
      `[transcription] Validation failed for recordingId=${id}: ${validated.error.message}`,
    );
    return c.json({ error: "Internal error: invalid transcription data" }, 500);
  }

  return c.json(validated.data);
});

export default app;
