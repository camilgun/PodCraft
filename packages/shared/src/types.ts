export interface HealthResponse {
  status: "ok";
}

export interface TranscribeResponse {
  text: string;
  language: string;
  inference_time_seconds: number;
  audio_duration_seconds: number;
  model_used: string;
}
