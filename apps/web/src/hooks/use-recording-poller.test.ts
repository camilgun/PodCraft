import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { Recording } from "@podcraft/shared";
import { useRecordingPoller } from "./use-recording-poller";

// Mock api-client so no real network calls are made
vi.mock("@/lib/api-client", () => ({
  getRecording: vi.fn(),
}));

import { getRecording } from "@/lib/api-client";
const mockGetRecording = vi.mocked(getRecording);

function makeRecording(status: Recording["status"]): Recording {
  return {
    id: "rec-1",
    filePath: "/audio/test.mp3",
    originalFilename: "test.mp3",
    durationSeconds: 60,
    sampleRate: 44100,
    channels: 1,
    format: "mp3",
    fileSizeBytes: 1024,
    status,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
  };
}

describe("useRecordingPoller", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockGetRecording.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not poll when status is not TRANSCRIBING", async () => {
    const onUpdate = vi.fn();
    renderHook(() => useRecordingPoller("rec-1", "IMPORTED", onUpdate));
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(mockGetRecording).not.toHaveBeenCalled();
  });

  it("does not poll when recordingId is undefined", async () => {
    const onUpdate = vi.fn();
    renderHook(() => useRecordingPoller(undefined, "TRANSCRIBING", onUpdate));
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(mockGetRecording).not.toHaveBeenCalled();
  });

  it("polls after 2s when status is TRANSCRIBING", async () => {
    mockGetRecording.mockResolvedValue({ ok: true, data: makeRecording("TRANSCRIBED") });
    const onUpdate = vi.fn();

    renderHook(() => useRecordingPoller("rec-1", "TRANSCRIBING", onUpdate));

    // Before 2s — no poll yet
    await act(() => vi.advanceTimersByTimeAsync(1999));
    expect(mockGetRecording).not.toHaveBeenCalled();

    // After 2s — poll fires
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(mockGetRecording).toHaveBeenCalledWith("rec-1");
  });

  it("calls onUpdate with the fresh recording after a successful poll", async () => {
    const transcribed = makeRecording("TRANSCRIBED");
    mockGetRecording.mockResolvedValue({ ok: true, data: transcribed });
    const onUpdate = vi.fn();

    renderHook(() => useRecordingPoller("rec-1", "TRANSCRIBING", onUpdate));
    await act(() => vi.advanceTimersByTimeAsync(2000));

    expect(onUpdate).toHaveBeenCalledWith(transcribed);
  });

  it("stops polling once status changes to TRANSCRIBED", async () => {
    const transcribed = makeRecording("TRANSCRIBED");
    mockGetRecording.mockResolvedValue({ ok: true, data: transcribed });
    const onUpdate = vi.fn();

    renderHook(() => useRecordingPoller("rec-1", "TRANSCRIBING", onUpdate));

    // First poll
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(mockGetRecording).toHaveBeenCalledTimes(1);

    // No further polls
    await act(() => vi.advanceTimersByTimeAsync(4000));
    expect(mockGetRecording).toHaveBeenCalledTimes(1);
  });

  it("continues polling while status remains TRANSCRIBING", async () => {
    mockGetRecording.mockResolvedValue({ ok: true, data: makeRecording("TRANSCRIBING") });
    const onUpdate = vi.fn();

    renderHook(() => useRecordingPoller("rec-1", "TRANSCRIBING", onUpdate));

    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(mockGetRecording).toHaveBeenCalledTimes(1);

    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(mockGetRecording).toHaveBeenCalledTimes(2);
  });

  it("retries on network error without stopping", async () => {
    mockGetRecording.mockResolvedValue({
      ok: false,
      error: { kind: "network" as const, message: "Network error" },
    });
    const onUpdate = vi.fn();

    renderHook(() => useRecordingPoller("rec-1", "TRANSCRIBING", onUpdate));

    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(mockGetRecording).toHaveBeenCalledTimes(1);

    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(mockGetRecording).toHaveBeenCalledTimes(2);

    // onUpdate should NOT have been called since responses were errors
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("cleans up the timer on unmount", async () => {
    mockGetRecording.mockResolvedValue({ ok: true, data: makeRecording("TRANSCRIBING") });
    const onUpdate = vi.fn();

    const { unmount } = renderHook(() => useRecordingPoller("rec-1", "TRANSCRIBING", onUpdate));

    unmount();

    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(mockGetRecording).not.toHaveBeenCalled();
  });
});
