import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Job } from "bullmq";
import type { TranscriptionJobData } from "./queue.js";
import type { WsProgressEvent } from "@podcraft/shared";
import type { TranscriptionPipelineOutcome } from "../services/transcription-pipeline.js";

// vi.hoisted ensures these values are initialized before vi.mock factories run
// (vi.mock is hoisted before imports, so variables declared here are available inside factories)
const { processorRef, handlers, mockPipeline, mockBroadcast, initArgs } = vi.hoisted(() => {
  const processorRef: { current: ((job: unknown) => Promise<unknown>) | undefined } = {
    current: undefined,
  };
  const handlers: Record<string, (...args: unknown[]) => unknown> = {};
  const mockPipeline = vi.fn<(recordingId: string) => Promise<TranscriptionPipelineOutcome>>();
  const mockBroadcast = vi.fn<(recordingId: string, event: WsProgressEvent) => void>();
  // Captures Worker constructor args at module init time (before vi.clearAllMocks runs)
  const initArgs: { name: string | undefined; opts: Record<string, unknown> | undefined } = {
    name: undefined,
    opts: undefined,
  };
  return { processorRef, handlers, mockPipeline, mockBroadcast, initArgs };
});

vi.mock("bullmq", () => ({
  Worker: vi
    .fn()
    .mockImplementation(
      (
        name: string,
        processor: (job: unknown) => Promise<unknown>,
        opts: Record<string, unknown>,
      ) => {
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

vi.mock("../services/ws.js", () => ({
  wsManager: { broadcast: mockBroadcast },
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
    mockPipeline.mockResolvedValue({ finalState: "TRANSCRIBED" });
  });

  it("creates a Worker on the 'transcription' queue with concurrency 1", () => {
    expect(initArgs.name).toBe("transcription");
    expect(initArgs.opts).toMatchObject({ concurrency: 1 });
    expect(processorRef.current).toBeTypeOf("function");
  });

  describe("processor (job handler)", () => {
    it("invokes runTranscriptionPipeline with the job's recordingId", async () => {
      const result = await processorRef.current!(makeJob("rec-abc"));

      expect(mockPipeline).toHaveBeenCalledOnce();
      expect(mockPipeline).toHaveBeenCalledWith("rec-abc");
      expect(result).toEqual({ finalState: "TRANSCRIBED" });
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

  describe("active event handler", () => {
    it("broadcasts progress at the beginning of transcription", () => {
      const handler = handlers["active"] as (job: MockJob) => void;
      handler(makeJob("rec-active", "job-active"));

      expect(mockBroadcast).toHaveBeenCalledOnce();
      expect(mockBroadcast).toHaveBeenCalledWith("rec-active", {
        type: "progress",
        recordingId: "rec-active",
        step: "transcribing",
        percent: 0,
      });
    });
  });

  describe("completed event handler", () => {
    it("broadcasts state_change when the pipeline finishes in TRANSCRIBED", () => {
      const handler = handlers["completed"] as (
        job: MockJob,
        result: TranscriptionPipelineOutcome,
      ) => void;
      handler(makeJob("rec-done", "job-99"), { finalState: "TRANSCRIBED" });

      expect(mockBroadcast).toHaveBeenCalledWith("rec-done", {
        type: "state_change",
        recordingId: "rec-done",
        newState: "TRANSCRIBED",
      });
    });

    it("broadcasts failed when the pipeline outcome is ERROR", () => {
      const handler = handlers["completed"] as (
        job: MockJob,
        result: TranscriptionPipelineOutcome,
      ) => void;
      handler(makeJob("rec-err-outcome", "job-100"), {
        finalState: "ERROR",
        error: "ASR failed",
      });

      expect(mockBroadcast).toHaveBeenCalledOnce();
      expect(mockBroadcast).toHaveBeenCalledWith("rec-err-outcome", {
        type: "failed",
        recordingId: "rec-err-outcome",
        error: "ASR failed",
      });
    });

    it("logs worker_job_complete with recordingId and jobId", () => {
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const handler = handlers["completed"] as (
        job: MockJob,
        result: TranscriptionPipelineOutcome,
      ) => void;
      handler(makeJob("rec-done", "job-99"), { finalState: "TRANSCRIBED" });

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
    it("broadcasts failed when the job is available", () => {
      const handler = handlers["failed"] as (job: MockJob | undefined, err: Error) => void;
      handler(makeJob("rec-fail", "job-77"), new Error("boom"));

      expect(mockBroadcast).toHaveBeenCalledOnce();
      expect(mockBroadcast).toHaveBeenCalledWith("rec-fail", {
        type: "failed",
        recordingId: "rec-fail",
        error: "boom",
      });
    });

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
      const handler = handlers["failed"] as (job: MockJob | undefined, err: Error) => void;
      handler(undefined, new Error("queue error"));

      const output = errSpy.mock.calls[0]![0] as string;
      const parsed = JSON.parse(output) as Record<string, unknown>;
      expect(parsed.step).toBe("worker_job_failed");
      expect(parsed.recordingId).toBeUndefined();
      expect(parsed.jobId).toBeUndefined();
      expect(parsed.error).toBe("Error: queue error");
    });

    it("does not broadcast when BullMQ passes undefined job", () => {
      const handler = handlers["failed"] as (job: MockJob | undefined, err: Error) => void;
      handler(undefined, new Error("queue error"));

      expect(mockBroadcast).not.toHaveBeenCalled();
    });
  });
});
