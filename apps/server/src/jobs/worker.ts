import { Worker } from "bullmq";
import type { Job } from "bullmq";
import { config } from "../config.js";
import type { TranscriptionJobData } from "./queue.js";
import {
  runTranscriptionPipeline,
  type TranscriptionPipelineOutcome,
} from "../services/transcription-pipeline.js";
import { wsManager } from "../services/ws.js";

export const transcriptionWorker = new Worker<TranscriptionJobData, TranscriptionPipelineOutcome>(
  "transcription",
  async (job) => {
    const recordingId = job.data.recordingId;
    console.log(JSON.stringify({ recordingId, step: "worker_job_start", jobId: job.id }));
    return runTranscriptionPipeline(recordingId);
  },
  {
    connection: { url: config.redisUrl },
    // Serial processing: ML models run on shared hardware (semaphore in Python),
    // so there's no benefit to parallelism.
    concurrency: 1,
  },
);

transcriptionWorker.on("active", (job: Job<TranscriptionJobData>) => {
  const jobId = job.id === undefined ? undefined : String(job.id);
  wsManager.broadcast(job.data.recordingId, {
    type: "progress",
    recordingId: job.data.recordingId,
    ...(jobId !== undefined ? { jobId } : {}),
    step: "transcribing",
    percent: 0,
  });
});

transcriptionWorker.on(
  "completed",
  (job: Job<TranscriptionJobData>, result: TranscriptionPipelineOutcome) => {
    const recordingId = job.data.recordingId;
    const jobId = job.id === undefined ? undefined : String(job.id);
    if (result.finalState === "TRANSCRIBED") {
      wsManager.broadcast(recordingId, {
        type: "state_change",
        recordingId,
        ...(jobId !== undefined ? { jobId } : {}),
        newState: "TRANSCRIBED",
      });
    } else {
      wsManager.broadcast(recordingId, {
        type: "failed",
        recordingId,
        ...(jobId !== undefined ? { jobId } : {}),
        error: result.error,
      });
    }

    console.log(
      JSON.stringify({
        recordingId: job.data.recordingId,
        step: "worker_job_complete",
        jobId: job.id,
      }),
    );
  },
);

transcriptionWorker.on("failed", (job: Job<TranscriptionJobData> | undefined, err) => {
  const recordingId = job?.data?.recordingId;
  const jobId = job?.id === undefined ? undefined : String(job.id);
  if (recordingId) {
    wsManager.broadcast(recordingId, {
      type: "failed",
      recordingId,
      ...(jobId !== undefined ? { jobId } : {}),
      error: err instanceof Error ? err.message : String(err),
    });
  }

  console.error(
    JSON.stringify({
      recordingId: job?.data?.recordingId,
      step: "worker_job_failed",
      jobId: job?.id,
      error: String(err),
    }),
  );
});
