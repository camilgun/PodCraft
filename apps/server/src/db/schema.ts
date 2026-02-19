import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const recordings = sqliteTable(
  "recordings",
  {
    id: text("id").primaryKey(),
    filePath: text("file_path").notNull(),
    originalFilename: text("original_filename").notNull(),
    // Nullable for backward compatibility — set at import, used by Library Sync
    // for hash-based reconciliation when a file is renamed or moved.
    // Value: lowercase SHA-256 hex of (first 1 MB of file ++ file_size_bytes).
    fileHash: text("file_hash"),
    // ISO 8601 datetime of the last file-presence check by Library Sync.
    fileLastCheckedAt: text("file_last_checked_at"),
    durationSeconds: real("duration_seconds").notNull(),
    sampleRate: integer("sample_rate").notNull(),
    channels: integer("channels").notNull(),
    format: text("format").notNull(), // wav | mp3 | m4a | flac | ogg
    fileSizeBytes: integer("file_size_bytes").notNull(),
    status: text("status").notNull().default("IMPORTED"),
    languageDetected: text("language_detected"),
    errorMessage: text("error_message"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull()
  },
  (table) => ({
    recordingsFilePathUnique: uniqueIndex("recordings_file_path_unique").on(table.filePath),
    recordingsFileHashIdx: index("recordings_file_hash_idx").on(table.fileHash)
  })
);

export const transcriptions = sqliteTable("transcriptions", {
  id: text("id").primaryKey(),
  recordingId: text("recording_id")
    .notNull()
    .references(() => recordings.id, { onDelete: "cascade" }),
  fullText: text("full_text").notNull(),
  // AlignedSegment[] serialized as JSON
  segments: text("segments").notNull(),
  modelUsed: text("model_used").notNull(),
  languageDetected: text("language_detected").notNull(),
  createdAt: text("created_at").notNull()
});

export const qualityScores = sqliteTable("quality_scores", {
  id: text("id").primaryKey(),
  recordingId: text("recording_id")
    .notNull()
    .references(() => recordings.id, { onDelete: "cascade" }),
  windowStart: real("window_start").notNull(),
  windowEnd: real("window_end").notNull(),
  mos: real("mos").notNull(),
  noisiness: real("noisiness").notNull(),
  discontinuity: real("discontinuity").notNull(),
  coloration: real("coloration").notNull(),
  loudness: real("loudness").notNull(),
  // SQLite stores booleans as integer (0/1); mode:'boolean' makes Drizzle convert automatically
  flagged: integer("flagged", { mode: "boolean" }).notNull().default(false),
  flaggedBy: text("flagged_by").notNull().default("auto"),
  createdAt: text("created_at").notNull()
});

export const analysisResults = sqliteTable("analysis_results", {
  id: text("id").primaryKey(),
  recordingId: text("recording_id")
    .notNull()
    .references(() => recordings.id, { onDelete: "cascade" }),
  summary: text("summary").notNull(),
  suggestedTitle: text("suggested_title").notNull(),
  // Chapter[] serialized as JSON
  chapters: text("chapters").notNull(),
  editorialNotes: text("editorial_notes").notNull(),
  createdAt: text("created_at").notNull()
});

export const editProposals = sqliteTable("edit_proposals", {
  id: text("id").primaryKey(),
  analysisResultId: text("analysis_result_id")
    .notNull()
    .references(() => analysisResults.id, { onDelete: "cascade" }),
  type: text("type").notNull(), // cut | reorder | tts_replace
  subtype: text("subtype"), // filler | repetition | off_topic | low_energy | tangent
  startTime: real("start_time").notNull(),
  endTime: real("end_time").notNull(),
  originalText: text("original_text").notNull(),
  reason: text("reason").notNull(),
  confidence: real("confidence").notNull(),
  proposedPosition: real("proposed_position"),
  status: text("status").notNull().default("proposed"),
  userStartTime: real("user_start_time"),
  userEndTime: real("user_end_time"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
});
