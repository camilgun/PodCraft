import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Hono } from "hono";
import { stream } from "hono/streaming";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { recordings } from "../db/schema.js";
import { parseSingleByteRange } from "../lib/http-range.js";

const app = new Hono();

const AUDIO_CONTENT_TYPE: Record<string, string> = {
  wav: "audio/wav",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  flac: "audio/flac",
  ogg: "audio/ogg"
};

/**
 * GET /api/files/:id/audio — serve the raw audio file for the browser player.
 * Supports the Range header for partial content (required by HTML5 audio).
 */
app.get("/api/files/:id/audio", async (c) => {
  const id = c.req.param("id");
  const rows = await db
    .select({
      id: recordings.id,
      filePath: recordings.filePath,
      format: recordings.format,
      status: recordings.status
    })
    .from(recordings)
    .where(eq(recordings.id, id))
    .limit(1);

  if (rows.length === 0) {
    return c.json({ error: "Recording not found" }, 404);
  }

  const row = rows[0]!;

  if (row.status === "FILE_MISSING") {
    return c.json({ error: "Audio file is not available on disk (FILE_MISSING)" }, 404);
  }

  // Verify file exists on disk
  let fileSize: number;
  try {
    const fileStat = await stat(row.filePath);
    fileSize = fileStat.size;
  } catch {
    return c.json({ error: "Audio file not found on disk" }, 404);
  }

  const contentType = AUDIO_CONTENT_TYPE[row.format] ?? "application/octet-stream";
  const rangeHeader = c.req.header("Range");

  // Partial content (Range request)
  if (rangeHeader) {
    const parsedRange = parseSingleByteRange(rangeHeader, fileSize);
    if (!parsedRange) {
      c.header("Content-Range", `bytes */${fileSize}`);
      c.header("Accept-Ranges", "bytes");
      return c.json({ error: "Range not satisfiable" }, 416);
    }

    const { start, end } = parsedRange;
    const chunkSize = end - start + 1;
    c.status(206);
    c.header("Content-Type", contentType);
    c.header("Content-Range", `bytes ${start}-${end}/${fileSize}`);
    c.header("Content-Length", String(chunkSize));
    c.header("Accept-Ranges", "bytes");

    return stream(c, async (s) => {
      const readable = createReadStream(row.filePath, { start, end });
      for await (const chunk of readable) {
        await s.write(chunk as Uint8Array);
      }
    });
  }

  // Full file
  c.header("Content-Type", contentType);
  c.header("Content-Length", String(fileSize));
  c.header("Accept-Ranges", "bytes");

  return stream(c, async (s) => {
    const readable = createReadStream(row.filePath);
    for await (const chunk of readable) {
      await s.write(chunk as Uint8Array);
    }
  });
});

export default app;
