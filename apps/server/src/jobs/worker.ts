import { Worker } from "bullmq";
import type { Job } from "bullmq";
import { config } from "../config.js";
import type { TranscriptionJobData } from "./queue.js";
import { runTranscriptionPipeline } from "../services/transcription-pipeline.js";

export const transcriptionWorker = new Worker<TranscriptionJobData>(
  "transcription",
  async (job) => {
    const recordingId = job.data.recordingId;
    console.log(JSON.stringify({ recordingId, step: "worker_job_start", jobId: job.id }));
    await runTranscriptionPipeline(recordingId);
  },
  {
    connection: { url: config.redisUrl },
    // Serial processing: ML models run on shared hardware (semaphore in Python),
    // so there's no benefit to parallelism.
    concurrency: 1,
  },
);

transcriptionWorker.on("completed", (job: Job<TranscriptionJobData>) => {
  console.log(
    JSON.stringify({
      recordingId: job.data.recordingId,
      step: "worker_job_complete",
      jobId: job.id,
    }),
  );
});

transcriptionWorker.on("failed", (job: Job<TranscriptionJobData> | undefined, err) => {
  console.error(
    JSON.stringify({
      recordingId: job?.data?.recordingId,
      step: "worker_job_failed",
      jobId: job?.id,
      error: String(err),
    }),
  );
});
