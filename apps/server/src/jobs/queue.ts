import { Queue } from "bullmq";
import { config } from "../config.js";

export type TranscriptionJobData = {
  recordingId: string;
};

export const transcriptionQueue = new Queue<TranscriptionJobData>("transcription", {
  connection: { url: config.redisUrl },
  defaultJobOptions: {
    // Keep completed jobs for 1h for debugging; failed jobs for 24h.
    removeOnComplete: { age: 3600 },
    removeOnFail: { age: 86400 },
    attempts: 1, // No automatic retry — the pipeline sets ERROR state itself.
  },
});
