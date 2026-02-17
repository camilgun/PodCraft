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

export interface AlignedWord {
  word: string;
  start_time: number;
  end_time: number;
}

export interface AlignResponse {
  words: AlignedWord[];
  inference_time_seconds: number;
  model_used: string;
}

export interface QualityWindow {
  window_start: number;
  window_end: number;
  mos: number;
  noisiness: number;
  discontinuity: number;
  coloration: number;
  loudness: number;
}

export interface QualityResponse {
  windows: QualityWindow[];
  average_mos: number;
  inference_time_seconds: number;
}
