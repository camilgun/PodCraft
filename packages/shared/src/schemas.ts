import { z } from "zod";

// ─── ML Service response schemas ──────────────────────────────────────────────

export const healthResponseSchema = z.object({
  status: z.literal("ok"),
});

export type HealthResponseFromSchema = z.infer<typeof healthResponseSchema>;

export const transcribeResponseSchema = z.object({
  text: z.string(),
  language: z.string().regex(/^[a-z]{2,3}$|^unknown$/),
  inference_time_seconds: z.number().nonnegative(),
  audio_duration_seconds: z.number().positive(),
  model_used: z.string(),
});

export type TranscribeResponseFromSchema = z.infer<typeof transcribeResponseSchema>;

export const mlAlignedWordSchema = z
  .object({
    word: z.string(),
    start_time: z.number().nonnegative(),
    end_time: z.number().nonnegative(),
  })
  .refine((value) => value.end_time >= value.start_time, {
    message: "end_time must be greater than or equal to start_time",
    path: ["end_time"],
  });

export type MlAlignedWordFromSchema = z.infer<typeof mlAlignedWordSchema>;

export const alignResponseSchema = z.object({
  words: z.array(mlAlignedWordSchema),
  inference_time_seconds: z.number().nonnegative(),
  model_used: z.string(),
});

export type AlignResponseFromSchema = z.infer<typeof alignResponseSchema>;

export const qualityWindowSchema = z
  .object({
    window_start: z.number().nonnegative(),
    window_end: z.number().nonnegative(),
    mos: z.number().min(1).max(5),
    noisiness: z.number().min(1).max(5),
    discontinuity: z.number().min(1).max(5),
    coloration: z.number().min(1).max(5),
    loudness: z.number().min(1).max(5),
  })
  .refine((value) => value.window_end >= value.window_start, {
    message: "window_end must be greater than or equal to window_start",
    path: ["window_end"],
  });

export type QualityWindowFromSchema = z.infer<typeof qualityWindowSchema>;

export const qualityResponseSchema = z.object({
  windows: z.array(qualityWindowSchema).min(1),
  average_mos: z.number().min(1).max(5),
  inference_time_seconds: z.number().nonnegative(),
});

export type QualityResponseFromSchema = z.infer<typeof qualityResponseSchema>;

// ─── Domain schemas ───────────────────────────────────────────────────────────

const isoDatetimeSchema = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/,
    "Must be ISO 8601 datetime",
  );

export const recordingStatusSchema = z.enum([
  "IMPORTED",
  "TRANSCRIBING",
  "TRANSCRIBED",
  "ANALYZING",
  "REVIEWED",
  "EXPORTING",
  "COMPLETED",
  "ERROR",
  "FILE_MISSING",
]);

export type RecordingStatusFromSchema = z.infer<typeof recordingStatusSchema>;

export const recordingSchema = z.object({
  id: z.string(),
  filePath: z.string(),
  originalFilename: z.string(),
  /** SHA-256 hex digest of the first 1 MB of the file concatenated with its size. */
  fileHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/, "Must be a lowercase SHA-256 hex string")
    .nullish(),
  /** ISO 8601 datetime of the last file-presence check by Library Sync. */
  fileLastCheckedAt: isoDatetimeSchema.nullish(),
  durationSeconds: z.number().nonnegative(),
  sampleRate: z.number().positive(),
  channels: z.number().int().positive(),
  format: z.enum(["wav", "mp3", "m4a", "flac", "ogg"]),
  fileSizeBytes: z.number().int().nonnegative(),
  status: recordingStatusSchema,
  languageDetected: z.string().nullish(),
  errorMessage: z.string().nullish(),
  createdAt: isoDatetimeSchema,
  updatedAt: isoDatetimeSchema,
});

export type RecordingFromSchema = z.infer<typeof recordingSchema>;

export const recordingsListResponseSchema = z.object({
  recordings: z.array(recordingSchema),
});

export type RecordingsListResponseFromSchema = z.infer<typeof recordingsListResponseSchema>;

export const recordingDetailResponseSchema = z.object({
  recording: recordingSchema,
});

export type RecordingDetailResponseFromSchema = z.infer<typeof recordingDetailResponseSchema>;

export const librarySyncResponseSchema = z.object({
  status: z.literal("sync_started"),
});

export type LibrarySyncResponseFromSchema = z.infer<typeof librarySyncResponseSchema>;

export const transcribeStartResponseSchema = z.object({
  status: z.enum(["accepted", "already_in_progress"]),
  recordingId: z.string(),
});

export type TranscribeStartResponseFromSchema = z.infer<typeof transcribeStartResponseSchema>;

export const alignedWordSchema = z
  .object({
    word: z.string(),
    startTime: z.number().nonnegative(),
    endTime: z.number().nonnegative(),
    confidence: z.number().min(0).max(1),
  })
  .refine((value) => value.endTime >= value.startTime, {
    message: "endTime must be greater than or equal to startTime",
    path: ["endTime"],
  });

export type AlignedWordFromSchema = z.infer<typeof alignedWordSchema>;

export const alignedSegmentSchema = z
  .object({
    id: z.string(),
    text: z.string(),
    startTime: z.number().nonnegative(),
    endTime: z.number().nonnegative(),
    orderIndex: z.number().int().nonnegative(),
    words: z.array(alignedWordSchema),
  })
  .refine((value) => value.endTime >= value.startTime, {
    message: "endTime must be greater than or equal to startTime",
    path: ["endTime"],
  });

export type AlignedSegmentFromSchema = z.infer<typeof alignedSegmentSchema>;

export const transcriptionSchema = z.object({
  id: z.string(),
  recordingId: z.string(),
  fullText: z.string(),
  segments: z.array(alignedSegmentSchema).min(1),
  modelUsed: z.string(),
  languageDetected: z.string(),
  createdAt: isoDatetimeSchema,
});

export type TranscriptionFromSchema = z.infer<typeof transcriptionSchema>;

export const qualityScoreSchema = z
  .object({
    id: z.string(),
    recordingId: z.string(),
    windowStart: z.number().nonnegative(),
    windowEnd: z.number().nonnegative(),
    mos: z.number().min(1).max(5),
    noisiness: z.number().min(1).max(5),
    discontinuity: z.number().min(1).max(5),
    coloration: z.number().min(1).max(5),
    loudness: z.number().min(1).max(5),
    flagged: z.boolean(),
    flaggedBy: z.enum(["auto", "user"]),
    createdAt: isoDatetimeSchema,
  })
  .refine((value) => value.windowEnd >= value.windowStart, {
    message: "windowEnd must be greater than or equal to windowStart",
    path: ["windowEnd"],
  });

export type QualityScoreFromSchema = z.infer<typeof qualityScoreSchema>;

export const chapterSchema = z
  .object({
    title: z.string(),
    startTime: z.number().nonnegative(),
    endTime: z.number().nonnegative(),
  })
  .refine((value) => value.endTime >= value.startTime, {
    message: "endTime must be greater than or equal to startTime",
    path: ["endTime"],
  });

export type ChapterFromSchema = z.infer<typeof chapterSchema>;

export const editProposalSchema = z
  .object({
    id: z.string(),
    analysisResultId: z.string(),
    type: z.enum(["cut", "reorder", "tts_replace"]),
    subtype: z.enum(["filler", "repetition", "off_topic", "low_energy", "tangent"]).nullish(),
    startTime: z.number().nonnegative(),
    endTime: z.number().nonnegative(),
    originalText: z.string(),
    reason: z.string(),
    confidence: z.number().min(0).max(1),
    proposedPosition: z.number().nonnegative().nullish(),
    status: z.enum(["proposed", "accepted", "rejected", "modified"]),
    userStartTime: z.number().nonnegative().nullish(),
    userEndTime: z.number().nonnegative().nullish(),
    createdAt: isoDatetimeSchema,
    updatedAt: isoDatetimeSchema,
  })
  .superRefine((value, context) => {
    if (value.endTime < value.startTime) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "endTime must be greater than or equal to startTime",
        path: ["endTime"],
      });
    }

    const userStartTime = value.userStartTime;
    const userEndTime = value.userEndTime;
    const hasUserStartTime = userStartTime !== null && userStartTime !== undefined;
    const hasUserEndTime = userEndTime !== null && userEndTime !== undefined;

    if (hasUserStartTime !== hasUserEndTime) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "userStartTime and userEndTime must be provided together",
        path: hasUserStartTime ? ["userEndTime"] : ["userStartTime"],
      });
      return;
    }

    if (hasUserStartTime && hasUserEndTime && userEndTime < userStartTime) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "userEndTime must be greater than or equal to userStartTime",
        path: ["userEndTime"],
      });
    }
  });

export type EditProposalFromSchema = z.infer<typeof editProposalSchema>;

export const analysisResultSchema = z.object({
  id: z.string(),
  recordingId: z.string(),
  summary: z.string(),
  suggestedTitle: z.string(),
  chapters: z.array(chapterSchema),
  editorialNotes: z.string(),
  proposals: z.array(editProposalSchema),
  createdAt: isoDatetimeSchema,
});

export type AnalysisResultFromSchema = z.infer<typeof analysisResultSchema>;
