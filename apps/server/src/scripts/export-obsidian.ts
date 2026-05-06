/**
 * Export all transcribed recordings to Obsidian-ready Markdown files.
 *
 * Usage:
 *   pnpm --filter @podcraft/server obsidian:export ~/path/to/vault/inbox
 *
 * One .md file per recording, named: "YYYY-MM-DD HH.mm - <title>.md"
 * Falls back to created_at if recorded_at is null.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { eq, isNotNull } from "drizzle-orm";
import { db } from "../db/index.js";
import { recordings, transcriptions } from "../db/schema.js";

const outputDir = process.argv[2] ?? "./obsidian-export";

if (!existsSync(outputDir)) {
  mkdirSync(outputDir, { recursive: true });
}

const rows = await db
  .select({
    id: recordings.id,
    originalFilename: recordings.originalFilename,
    recordedAt: recordings.recordedAt,
    createdAt: recordings.createdAt,
    durationSeconds: recordings.durationSeconds,
    languageDetected: recordings.languageDetected,
    fullText: transcriptions.fullText,
    modelUsed: transcriptions.modelUsed,
  })
  .from(recordings)
  .innerJoin(transcriptions, eq(transcriptions.recordingId, recordings.id))
  .where(isNotNull(transcriptions.fullText))
  .orderBy(recordings.recordedAt);

console.log(`Esportazione di ${rows.length} registrazioni in: ${outputDir}\n`);

const itDateFull = new Intl.DateTimeFormat("it-IT", {
  day: "numeric",
  month: "long",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Rome",
});

const itDateShort = new Intl.DateTimeFormat("it-IT", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: "Europe/Rome",
});

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function toFileSafeDate(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  const rome = new Date(d.toLocaleString("en-US", { timeZone: "Europe/Rome" }));
  const yyyy = rome.getFullYear();
  const mm = pad(rome.getMonth() + 1);
  const dd = pad(rome.getDate());
  const hh = pad(rome.getHours());
  const min = pad(rome.getMinutes());
  return `${yyyy}-${mm}-${dd} ${hh}.${min}`;
}

function titleFromFilename(filename: string): string {
  return filename.replace(/\.[^.]+$/, "");
}

function sanitizeFilename(name: string): string {
  return name.replace(/[/\\:*?"<>|]/g, "-").trim();
}

// ISO date string → YYYY-MM-DD for YAML
function toIsoDate(iso: string): string {
  return itDateShort.format(new Date(iso)).split("/").reverse().join("-");
}

let written = 0;
const skipped = 0;

for (const row of rows) {
  const dateIso = row.recordedAt ?? row.createdAt;
  const datePrefix = toFileSafeDate(dateIso);
  const title = titleFromFilename(row.originalFilename);
  const filename = sanitizeFilename(`${datePrefix} - ${title}`) + ".md";
  const filePath = join(outputDir, filename);

  const recordedAtFormatted = itDateFull.format(new Date(dateIso));
  const yamlDate = toIsoDate(dateIso);
  const durationFormatted = formatDuration(row.durationSeconds);
  const durationMinutes = (row.durationSeconds / 60).toFixed(1);

  const md = `---
date: ${yamlDate}
recorded_at: "${dateIso}"
duration_minutes: ${durationMinutes}
original_filename: "${row.originalFilename}"
language: ${row.languageDetected ?? "it"}
status: raw
tags: []
---

# ${title}

**Registrato il:** ${recordedAtFormatted}
**Durata:** ${durationFormatted}

---

${row.fullText}
`;

  writeFileSync(filePath, md, "utf-8");
  console.log(`  [ok] ${filename}`);
  written++;
}

console.log(`\nFatto. Scritti: ${written}, Saltati: ${skipped}.`);
