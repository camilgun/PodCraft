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

export const alignedWordSchema = z
  .object({
    word: z.string(),
    start_time: z.number().nonnegative(),
    end_time: z.number().nonnegative()
  })
  .refine((value) => value.end_time >= value.start_time, {
    message: "end_time must be greater than or equal to start_time",
    path: ["end_time"]
  });

export type AlignedWordFromSchema = z.infer<typeof alignedWordSchema>;

export const alignResponseSchema = z.object({
  words: z.array(alignedWordSchema),
  inference_time_seconds: z.number().nonnegative(),
  model_used: z.string()
});

export type AlignResponseFromSchema = z.infer<typeof alignResponseSchema>;
