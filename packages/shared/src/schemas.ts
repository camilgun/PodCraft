import { z } from "zod";

export const healthResponseSchema = z.object({
  status: z.literal("ok")
});

export type HealthResponseFromSchema = z.infer<typeof healthResponseSchema>;

export const transcribeResponseSchema = z.object({
  text: z.string(),
  language: z.string().regex(/^[a-z]{2,3}$|^unknown$/),
  inference_time_seconds: z.number().nonnegative(),
  audio_duration_seconds: z.number().positive(),
  model_used: z.string()
});

export type TranscribeResponseFromSchema = z.infer<typeof transcribeResponseSchema>;
