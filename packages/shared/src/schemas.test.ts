import { describe, expect, it } from "vitest";
import {
  alignResponseSchema,
  healthResponseSchema,
  qualityResponseSchema,
  qualityWindowSchema,
  transcribeResponseSchema,
  recordingSchema,
  recordingStatusSchema,
  alignedWordSchema,
  alignedSegmentSchema,
  transcriptionSchema,
  qualityScoreSchema,
  editProposalSchema,
  chapterSchema,
  analysisResultSchema,
  type AlignResponseFromSchema,
  type HealthResponseFromSchema,
  type QualityResponseFromSchema,
  type QualityWindowFromSchema,
  type TranscribeResponseFromSchema,
  type RecordingFromSchema,
  type AlignedWordFromSchema,
  type AlignedSegmentFromSchema,
  type TranscriptionFromSchema,
  type QualityScoreFromSchema,
  type EditProposalFromSchema,
  type AnalysisResultFromSchema
} from "./index";

describe("healthResponseSchema", () => {
  it("accepts a valid health payload", () => {
    const parsed: HealthResponseFromSchema = healthResponseSchema.parse({ status: "ok" });
    expect(parsed.status).toBe("ok");
  });

  it("rejects an invalid health payload", () => {
    const parsed = healthResponseSchema.safeParse({ status: "down" });
    expect(parsed.success).toBe(false);
  });
});

describe("transcribeResponseSchema", () => {
  it("accepts a valid transcribe payload", () => {
    const parsed: TranscribeResponseFromSchema = transcribeResponseSchema.parse({
      text: "ciao mondo",
      language: "it",
      inference_time_seconds: 1.2,
      audio_duration_seconds: 60.5,
      model_used: "mlx-community/Qwen3-ASR-1.7B-bf16"
    });

    expect(parsed.language).toBe("it");
    expect(parsed.inference_time_seconds).toBe(1.2);
  });

  it("rejects invalid transcribe payload", () => {
    const parsed = transcribeResponseSchema.safeParse({
      text: "ciao mondo",
      language: "Italian",
      inference_time_seconds: -1,
      audio_duration_seconds: 0,
      model_used: "mlx-community/Qwen3-ASR-1.7B-bf16"
    });

    expect(parsed.success).toBe(false);
  });

  it("accepts unknown language sentinel", () => {
    const parsed: TranscribeResponseFromSchema = transcribeResponseSchema.parse({
      text: "ciao mondo",
      language: "unknown",
      inference_time_seconds: 1.2,
      audio_duration_seconds: 60.5,
      model_used: "mlx-community/Qwen3-ASR-1.7B-bf16"
    });

    expect(parsed.language).toBe("unknown");
  });
});

describe("alignResponseSchema", () => {
  it("accepts a valid align payload", () => {
    const parsed: AlignResponseFromSchema = alignResponseSchema.parse({
      words: [
        { word: "ciao", start_time: 0.1, end_time: 0.4 },
        { word: "mondo", start_time: 0.5, end_time: 0.9 }
      ],
      inference_time_seconds: 0.8,
      model_used: "mlx-community/Qwen3-ForcedAligner-0.6B-bf16"
    });

    expect(parsed.words).toHaveLength(2);
    expect(parsed.words[0]?.word).toBe("ciao");
  });

  it("rejects invalid align payload", () => {
    const result = alignResponseSchema.safeParse({
      words: [
        { word: "ciao", start_time: 1.0, end_time: 0.5 },
        { word: "mondo", start_time: -1, end_time: 0.9 }
      ],
      inference_time_seconds: -0.2,
      model_used: "mlx-community/Qwen3-ForcedAligner-0.6B-bf16"
    });

    expect(result.success).toBe(false);
  });
});

describe("qualityWindowSchema", () => {
  it("accepts a valid quality window payload", () => {
    const parsed: QualityWindowFromSchema = qualityWindowSchema.parse({
      window_start: 0,
      window_end: 5,
      mos: 3.8,
      noisiness: 2.4,
      discontinuity: 2.1,
      coloration: 2.2,
      loudness: 3.0
    });

    expect(parsed.window_start).toBe(0);
    expect(parsed.window_end).toBe(5);
    expect(parsed.mos).toBe(3.8);
  });

  it("rejects invalid quality window payload", () => {
    const result = qualityWindowSchema.safeParse({
      window_start: 5,
      window_end: 4,
      mos: 6,
      noisiness: 0,
      discontinuity: -1,
      coloration: 2.2,
      loudness: 3.0
    });

    expect(result.success).toBe(false);
  });
});

describe("qualityResponseSchema", () => {
  it("accepts a valid quality response payload", () => {
    const parsed: QualityResponseFromSchema = qualityResponseSchema.parse({
      windows: [
        {
          window_start: 0,
          window_end: 5,
          mos: 3.2,
          noisiness: 2.1,
          discontinuity: 2.0,
          coloration: 2.3,
          loudness: 3.1
        }
      ],
      average_mos: 3.2,
      inference_time_seconds: 0.72
    });

    expect(parsed.windows).toHaveLength(1);
    expect(parsed.average_mos).toBe(3.2);
  });

  it("rejects invalid quality response payload", () => {
    const result = qualityResponseSchema.safeParse({
      windows: [],
      average_mos: 0.8,
      inference_time_seconds: -0.1
    });

    expect(result.success).toBe(false);
  });
});

// ─── Domain schemas ───────────────────────────────────────────────────────────

describe("recordingStatusSchema", () => {
  it("accepts all valid statuses", () => {
    const statuses = [
      "IMPORTED",
      "TRANSCRIBING",
      "TRANSCRIBED",
      "ANALYZING",
      "REVIEWED",
      "EXPORTING",
      "COMPLETED",
      "ERROR",
      "FILE_MISSING"
    ];
    for (const status of statuses) {
      expect(recordingStatusSchema.safeParse(status).success).toBe(true);
    }
  });

  it("rejects an invalid status", () => {
    expect(recordingStatusSchema.safeParse("PENDING").success).toBe(false);
    expect(recordingStatusSchema.safeParse("").success).toBe(false);
  });
});

describe("recordingSchema", () => {
  const validRecording = {
    id: "rec-001",
    filePath: "/Users/test/registrazioni/test.m4a",
    originalFilename: "test.m4a",
    durationSeconds: 120.5,
    sampleRate: 44100,
    channels: 2,
    format: "m4a",
    fileSizeBytes: 1024000,
    status: "IMPORTED",
    createdAt: "2026-02-18T10:00:00Z",
    updatedAt: "2026-02-18T10:00:00Z"
  };

  it("accepts a valid recording", () => {
    const parsed: RecordingFromSchema = recordingSchema.parse(validRecording);
    expect(parsed.id).toBe("rec-001");
    expect(parsed.format).toBe("m4a");
    expect(parsed.status).toBe("IMPORTED");
  });

  it("accepts optional fields", () => {
    const parsed: RecordingFromSchema = recordingSchema.parse({
      ...validRecording,
      languageDetected: "it",
      errorMessage: undefined
    });
    expect(parsed.languageDetected).toBe("it");
  });

  it("accepts nullable fields from DB rows", () => {
    const parsed: RecordingFromSchema = recordingSchema.parse({
      ...validRecording,
      fileHash: null,
      fileLastCheckedAt: null,
      languageDetected: null,
      errorMessage: null
    });
    expect(parsed.fileHash).toBeNull();
    expect(parsed.fileLastCheckedAt).toBeNull();
    expect(parsed.languageDetected).toBeNull();
    expect(parsed.errorMessage).toBeNull();
  });

  it("accepts FILE_MISSING status", () => {
    const parsed: RecordingFromSchema = recordingSchema.parse({
      ...validRecording,
      status: "FILE_MISSING"
    });
    expect(parsed.status).toBe("FILE_MISSING");
  });

  it("accepts fileHash and fileLastCheckedAt when present", () => {
    const parsed: RecordingFromSchema = recordingSchema.parse({
      ...validRecording,
      fileHash: "a".repeat(64),
      fileLastCheckedAt: "2026-02-18T10:00:00Z"
    });
    expect(parsed.fileHash).toBe("a".repeat(64));
    expect(parsed.fileLastCheckedAt).toBe("2026-02-18T10:00:00Z");
  });

  it("accepts recording without fileHash (nullable — legacy rows)", () => {
    const parsed: RecordingFromSchema = recordingSchema.parse(validRecording);
    expect(parsed.fileHash).toBeUndefined();
    expect(parsed.fileLastCheckedAt).toBeUndefined();
  });

  it("rejects fileHash that is not a 64-char hex string", () => {
    expect(
      recordingSchema.safeParse({ ...validRecording, fileHash: "not-a-hash" }).success
    ).toBe(false);
    expect(
      recordingSchema.safeParse({ ...validRecording, fileHash: "A".repeat(64) }).success
    ).toBe(false); // uppercase not allowed
    expect(
      recordingSchema.safeParse({ ...validRecording, fileHash: "a".repeat(63) }).success
    ).toBe(false); // wrong length
  });

  it("rejects an invalid audio format", () => {
    const result = recordingSchema.safeParse({ ...validRecording, format: "aac" });
    expect(result.success).toBe(false);
  });

  it("rejects negative durationSeconds", () => {
    const result = recordingSchema.safeParse({ ...validRecording, durationSeconds: -1 });
    expect(result.success).toBe(false);
  });

  it("rejects invalid datetime", () => {
    const result = recordingSchema.safeParse({
      ...validRecording,
      createdAt: "not-a-date"
    });
    expect(result.success).toBe(false);
  });

  it("rejects datetime with valid prefix plus trailing garbage", () => {
    const result = recordingSchema.safeParse({
      ...validRecording,
      createdAt: "2026-02-18T10:00:00Z_extra"
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid status", () => {
    const result = recordingSchema.safeParse({ ...validRecording, status: "UNKNOWN" });
    expect(result.success).toBe(false);
  });
});

describe("alignedWordSchema (domain)", () => {
  it("accepts a valid aligned word", () => {
    const parsed: AlignedWordFromSchema = alignedWordSchema.parse({
      word: "ciao",
      startTime: 0.1,
      endTime: 0.4,
      confidence: 0.95
    });
    expect(parsed.word).toBe("ciao");
    expect(parsed.confidence).toBe(0.95);
  });

  it("rejects endTime < startTime", () => {
    const result = alignedWordSchema.safeParse({
      word: "ciao",
      startTime: 1.0,
      endTime: 0.5,
      confidence: 0.9
    });
    expect(result.success).toBe(false);
  });

  it("rejects confidence out of range", () => {
    const result = alignedWordSchema.safeParse({
      word: "ciao",
      startTime: 0.1,
      endTime: 0.4,
      confidence: 1.5
    });
    expect(result.success).toBe(false);
  });
});

describe("alignedSegmentSchema", () => {
  const validWord = { word: "ciao", startTime: 0.1, endTime: 0.4, confidence: 0.9 };

  it("accepts a valid aligned segment", () => {
    const parsed: AlignedSegmentFromSchema = alignedSegmentSchema.parse({
      id: "seg-001",
      text: "ciao mondo",
      startTime: 0.1,
      endTime: 1.0,
      orderIndex: 0,
      words: [validWord, { word: "mondo", startTime: 0.5, endTime: 0.9, confidence: 0.85 }]
    });
    expect(parsed.id).toBe("seg-001");
    expect(parsed.words).toHaveLength(2);
  });

  it("rejects endTime < startTime", () => {
    const result = alignedSegmentSchema.safeParse({
      id: "seg-001",
      text: "ciao",
      startTime: 2.0,
      endTime: 1.0,
      orderIndex: 0,
      words: [validWord]
    });
    expect(result.success).toBe(false);
  });

  it("accepts empty words array", () => {
    const result = alignedSegmentSchema.safeParse({
      id: "seg-001",
      text: "ciao",
      startTime: 0.0,
      endTime: 1.0,
      orderIndex: 0,
      words: []
    });
    expect(result.success).toBe(true);
  });
});

describe("transcriptionSchema", () => {
  const validSegment = {
    id: "seg-001",
    text: "ciao mondo",
    startTime: 0.1,
    endTime: 1.0,
    orderIndex: 0,
    words: [{ word: "ciao", startTime: 0.1, endTime: 0.4, confidence: 0.9 }]
  };

  it("accepts a valid transcription", () => {
    const parsed: TranscriptionFromSchema = transcriptionSchema.parse({
      id: "tx-001",
      recordingId: "rec-001",
      fullText: "ciao mondo",
      segments: [validSegment],
      modelUsed: "mlx-community/Qwen3-ASR-1.7B-bf16",
      languageDetected: "it",
      createdAt: "2026-02-18T10:00:00Z"
    });
    expect(parsed.segments).toHaveLength(1);
    expect(parsed.languageDetected).toBe("it");
  });

  it("rejects empty segments array", () => {
    const result = transcriptionSchema.safeParse({
      id: "tx-001",
      recordingId: "rec-001",
      fullText: "ciao",
      segments: [],
      modelUsed: "model",
      languageDetected: "it",
      createdAt: "2026-02-18T10:00:00Z"
    });
    expect(result.success).toBe(false);
  });
});

describe("qualityScoreSchema", () => {
  const validScore = {
    id: "qs-001",
    recordingId: "rec-001",
    windowStart: 0,
    windowEnd: 3,
    mos: 3.8,
    noisiness: 2.4,
    discontinuity: 2.1,
    coloration: 2.2,
    loudness: 3.0,
    flagged: false,
    flaggedBy: "auto",
    createdAt: "2026-02-18T10:00:00Z"
  };

  it("accepts a valid quality score", () => {
    const parsed: QualityScoreFromSchema = qualityScoreSchema.parse(validScore);
    expect(parsed.mos).toBe(3.8);
    expect(parsed.flagged).toBe(false);
    expect(parsed.flaggedBy).toBe("auto");
  });

  it("accepts flaggedBy user", () => {
    const parsed: QualityScoreFromSchema = qualityScoreSchema.parse({
      ...validScore,
      flagged: true,
      flaggedBy: "user"
    });
    expect(parsed.flaggedBy).toBe("user");
  });

  it("rejects MOS out of range", () => {
    expect(qualityScoreSchema.safeParse({ ...validScore, mos: 0.5 }).success).toBe(false);
    expect(qualityScoreSchema.safeParse({ ...validScore, mos: 5.5 }).success).toBe(false);
  });

  it("rejects windowEnd < windowStart", () => {
    const result = qualityScoreSchema.safeParse({
      ...validScore,
      windowStart: 10,
      windowEnd: 9
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid flaggedBy", () => {
    const result = qualityScoreSchema.safeParse({ ...validScore, flaggedBy: "system" });
    expect(result.success).toBe(false);
  });
});

describe("editProposalSchema", () => {
  const validProposal = {
    id: "ep-001",
    recordingId: "rec-001",
    type: "cut",
    startTime: 0.0,
    endTime: 5.0,
    originalText: "allora ehm",
    reason: "Filler words at the beginning",
    confidence: 0.9,
    status: "proposed",
    createdAt: "2026-02-18T10:00:00Z",
    updatedAt: "2026-02-18T10:00:00Z"
  };

  it("accepts a valid cut proposal", () => {
    const parsed: EditProposalFromSchema = editProposalSchema.parse(validProposal);
    expect(parsed.type).toBe("cut");
    expect(parsed.status).toBe("proposed");
  });

  it("accepts optional subtype", () => {
    const parsed: EditProposalFromSchema = editProposalSchema.parse({
      ...validProposal,
      subtype: "filler"
    });
    expect(parsed.subtype).toBe("filler");
  });

  it("accepts null for DB-nullable optional fields", () => {
    const parsed: EditProposalFromSchema = editProposalSchema.parse({
      ...validProposal,
      subtype: null,
      proposedPosition: null,
      userStartTime: null,
      userEndTime: null
    });
    expect(parsed.subtype).toBeNull();
    expect(parsed.proposedPosition).toBeNull();
    expect(parsed.userStartTime).toBeNull();
    expect(parsed.userEndTime).toBeNull();
  });

  it("accepts reorder with proposedPosition", () => {
    const parsed: EditProposalFromSchema = editProposalSchema.parse({
      ...validProposal,
      type: "reorder",
      proposedPosition: 3
    });
    expect(parsed.type).toBe("reorder");
    expect(parsed.proposedPosition).toBe(3);
  });

  it("rejects invalid type", () => {
    const result = editProposalSchema.safeParse({ ...validProposal, type: "delete" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid status", () => {
    const result = editProposalSchema.safeParse({ ...validProposal, status: "pending" });
    expect(result.success).toBe(false);
  });

  it("rejects confidence out of range", () => {
    const result = editProposalSchema.safeParse({ ...validProposal, confidence: 1.1 });
    expect(result.success).toBe(false);
  });

  it("rejects endTime < startTime", () => {
    const result = editProposalSchema.safeParse({
      ...validProposal,
      startTime: 10,
      endTime: 9
    });
    expect(result.success).toBe(false);
  });

  it("rejects only userStartTime without userEndTime", () => {
    const result = editProposalSchema.safeParse({
      ...validProposal,
      userStartTime: 1.2,
      userEndTime: null
    });
    expect(result.success).toBe(false);
  });

  it("rejects only userEndTime without userStartTime", () => {
    const result = editProposalSchema.safeParse({
      ...validProposal,
      userStartTime: undefined,
      userEndTime: 1.5
    });
    expect(result.success).toBe(false);
  });

  it("rejects userEndTime < userStartTime", () => {
    const result = editProposalSchema.safeParse({
      ...validProposal,
      userStartTime: 4,
      userEndTime: 3
    });
    expect(result.success).toBe(false);
  });

  it("accepts coherent userStartTime/userEndTime pair", () => {
    const result = editProposalSchema.safeParse({
      ...validProposal,
      userStartTime: 3,
      userEndTime: 4
    });
    expect(result.success).toBe(true);
  });

  it("accepts all valid statuses", () => {
    for (const status of ["proposed", "accepted", "rejected", "modified"]) {
      expect(
        editProposalSchema.safeParse({ ...validProposal, status }).success
      ).toBe(true);
    }
  });
});

describe("chapterSchema", () => {
  it("accepts a valid chapter", () => {
    const result = chapterSchema.parse({
      title: "Introduzione",
      startTime: 0,
      endTime: 120
    });
    expect(result.title).toBe("Introduzione");
  });

  it("rejects endTime < startTime", () => {
    const result = chapterSchema.safeParse({
      title: "Test",
      startTime: 60,
      endTime: 30
    });
    expect(result.success).toBe(false);
  });
});

describe("analysisResultSchema", () => {
  const validProposal = {
    id: "ep-001",
    recordingId: "rec-001",
    type: "cut",
    startTime: 0.0,
    endTime: 5.0,
    originalText: "allora ehm",
    reason: "Filler words",
    confidence: 0.9,
    status: "proposed",
    createdAt: "2026-02-18T10:00:00Z",
    updatedAt: "2026-02-18T10:00:00Z"
  };

  it("accepts a valid analysis result", () => {
    const parsed: AnalysisResultFromSchema = analysisResultSchema.parse({
      id: "ar-001",
      recordingId: "rec-001",
      summary: "Una registrazione sul tema AI",
      suggestedTitle: "L'AI nel 2026",
      chapters: [{ title: "Intro", startTime: 0, endTime: 30 }],
      editorialNotes: "Buon ritmo generale, alcuni filler da rimuovere",
      proposals: [validProposal],
      createdAt: "2026-02-18T10:00:00Z"
    });
    expect(parsed.chapters).toHaveLength(1);
    expect(parsed.proposals).toHaveLength(1);
  });

  it("accepts empty chapters and proposals", () => {
    const result = analysisResultSchema.safeParse({
      id: "ar-001",
      recordingId: "rec-001",
      summary: "Riepilogo",
      suggestedTitle: "Titolo",
      chapters: [],
      editorialNotes: "Note",
      proposals: [],
      createdAt: "2026-02-18T10:00:00Z"
    });
    expect(result.success).toBe(true);
  });
});
