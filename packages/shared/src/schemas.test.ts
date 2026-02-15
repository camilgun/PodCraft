import { describe, expect, it } from "vitest";
import { healthResponseSchema, transcribeResponseSchema } from "./schemas";

describe("healthResponseSchema", () => {
  it("accepts a valid health payload", () => {
    const parsed = healthResponseSchema.parse({ status: "ok" });
    expect(parsed.status).toBe("ok");
  });

  it("rejects an invalid health payload", () => {
    const parsed = healthResponseSchema.safeParse({ status: "down" });
    expect(parsed.success).toBe(false);
  });
});

describe("transcribeResponseSchema", () => {
  it("accepts a valid transcribe payload", () => {
    const parsed = transcribeResponseSchema.parse({
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
    const parsed = transcribeResponseSchema.parse({
      text: "ciao mondo",
      language: "unknown",
      inference_time_seconds: 1.2,
      audio_duration_seconds: 60.5,
      model_used: "mlx-community/Qwen3-ASR-1.7B-bf16"
    });

    expect(parsed.language).toBe("unknown");
  });
});
