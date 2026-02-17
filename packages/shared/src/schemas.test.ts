import { describe, expect, it } from "vitest";
import {
  alignResponseSchema,
  healthResponseSchema,
  qualityResponseSchema,
  qualityWindowSchema,
  transcribeResponseSchema,
  type AlignResponseFromSchema,
  type HealthResponseFromSchema,
  type QualityResponseFromSchema,
  type QualityWindowFromSchema,
  type TranscribeResponseFromSchema
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
