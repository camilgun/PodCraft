/**
 * One-shot backfill: reads creation_time from each recording's file metadata
 * and writes it to the recorded_at column in the DB.
 *
 * Run with: pnpm --filter @podcraft/server db:backfill-recorded-at
 */
import { eq, isNull } from "drizzle-orm";
import { db } from "../db/index.js";
import { recordings } from "../db/schema.js";
import { extractRecordedAt } from "../lib/ffprobe.js";

const rows = await db
  .select({ id: recordings.id, filePath: recordings.filePath })
  .from(recordings)
  .where(isNull(recordings.recordedAt));

console.log(`Found ${rows.length} recordings without recordedAt.`);

let updated = 0;
let skipped = 0;

for (const row of rows) {
  const recordedAt = await extractRecordedAt(row.filePath);
  if (recordedAt == null) {
    skipped++;
    console.log(`  [skip] ${row.filePath} — no creation_time tag`);
    continue;
  }

  await db
    .update(recordings)
    .set({ recordedAt })
    .where(eq(recordings.id, row.id));

  updated++;
  console.log(`  [ok]   ${row.filePath} → ${recordedAt}`);
}

console.log(`\nDone. Updated: ${updated}, Skipped: ${skipped}.`);
