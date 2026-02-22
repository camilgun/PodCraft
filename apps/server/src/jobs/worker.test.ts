import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Job } from "bullmq";
import type { TranscriptionJobData } from "./queue.js";

// vi.hoisted ensures these values are initialized before vi.mock factories run
// (vi.mock is hoisted before imports, so variables declared here are available inside factories)
const { processorRef, handlers, mockPipeline, initArgs } = vi.hoisted(() => {
  const processorRef: { current: ((job: unknown) => Promise<void>) | undefined } = {
    current: undefined,
  };
  const handlers: Record<string, (...args: unknown[]) => unknown> = {};
  const mockPipeline = vi.fn<(recordingId: string) => Promise<void>>();
  // Captures Worker constructor args at module init time (before vi.clearAllMocks runs)
  const initArgs: { name: string | undefined; opts: Record<string, unknown> | undefined } = {
    name: undefined,
    opts: undefined,
  };
  return { processorRef, handlers, mockPipeline, initArgs };
});

vi.mock("bullmq", () => ({
  Worker: vi.fn().mockImplementation(
    (name: string, processor: (job: unknown) => Promise<void>, opts: Record<string, unknown>) => {
      processorRef.current = processor;
      initArgs.name = name;
      initArgs.opts = opts;
      return {
        on: vi.fn((event: string, handler: (...args: unknown[]) => unknown) => {
          handlers[event] = handler;
        }),
      };
    },
  ),
}));

vi.mock("../config.js", () => ({
  config: { redisUrl: "redis://localhost:6379" },
}));

vi.mock("../services/transcription-pipeline.js", () => ({
  runTranscriptionPipeline: mockPipeline,
}));

// Side-effect import: triggers module initialization (new Worker(...) + .on() calls)
import "../jobs/worker.js";

type MockJob = Job<TranscriptionJobData>;

function makeJob(recordingId: string, id = "job-1"): MockJob {
  return { id, data: { recordingId } } as unknown as MockJob;
}

describe("transcriptionWorker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPipeline.mockResolvedValue(undefined);
  });

  it("creates a Worker on the 'transcription' queue with concurrency 1", () => {
    expect(initArgs.name).toBe("transcription");
    expect(initArgs.opts).toMatchObject({ concurrency: 1 });
    expect(processorRef.current).toBeTypeOf("function");
  });

  describe("processor (job handler)", () => {
    it("invokes runTranscriptionPipeline with the job's recordingId", async () => {
      await processorRef.current!(makeJob("rec-abc"));

      expect(mockPipeline).toHaveBeenCalledOnce();
      expect(mockPipeline).toHaveBeenCalledWith("rec-abc");
    });

    it("logs worker_job_start with recordingId and jobId before running the pipeline", async () => {
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      await processorRef.current!(makeJob("rec-123", "job-42"));

      const firstLog = logSpy.mock.calls[0]![0] as string;
      const parsed = JSON.parse(firstLog) as Record<string, unknown>;
      expect(parsed).toMatchObject({
        step: "worker_job_start",
        recordingId: "rec-123",
        jobId: "job-42",
      });
    });

    it("propagates errors thrown by the pipeline to BullMQ", async () => {
      mockPipeline.mockRejectedValueOnce(new Error("pipeline failure"));

      await expect(processorRef.current!(makeJob("rec-err"))).rejects.toThrow("pipeline failure");
    });
  });

  describe("completed event handler", () => {
    it("logs worker_job_complete with recordingId and jobId", () => {
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const handler = handlers["completed"] as (job: MockJob) => void;
      handler(makeJob("rec-done", "job-99"));

      const output = logSpy.mock.calls[0]![0] as string;
      const parsed = JSON.parse(output) as Record<string, unknown>;
      expect(parsed).toMatchObject({
        step: "worker_job_complete",
        recordingId: "rec-done",
        jobId: "job-99",
      });
    });
  });

  describe("failed event handler", () => {
    it("logs worker_job_failed with error, recordingId, and jobId", () => {
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const handler = handlers["failed"] as (job: MockJob, err: Error) => void;
      handler(makeJob("rec-fail", "job-77"), new Error("boom"));

      const output = errSpy.mock.calls[0]![0] as string;
      const parsed = JSON.parse(output) as Record<string, unknown>;
      expect(parsed).toMatchObject({
        step: "worker_job_failed",
        recordingId: "rec-fail",
        jobId: "job-77",
        error: "Error: boom",
      });
    });

    it("handles undefined job (BullMQ passes undefined on unrecoverable queue errors)", () => {
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const handler = handlers["failed"] as (
        job: MockJob | undefined,
        err: Error,
      ) => void;
      handler(undefined, new Error("queue error"));

      const output = errSpy.mock.calls[0]![0] as string;
      const parsed = JSON.parse(output) as Record<string, unknown>;
      expect(parsed.step).toBe("worker_job_failed");
      expect(parsed.recordingId).toBeUndefined();
      expect(parsed.jobId).toBeUndefined();
      expect(parsed.error).toBe("Error: queue error");
    });
  });
});
