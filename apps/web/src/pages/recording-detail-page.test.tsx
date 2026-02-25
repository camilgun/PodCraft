import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Recording, WsProgressEvent } from "@podcraft/shared";
import type { ReactNode } from "react";

const wsState = vi.hoisted(() => ({
  lastEvent: null as WsProgressEvent | null,
  isConnected: true,
}));

vi.mock("react-router", () => ({
  Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
  useParams: () => ({ id: "rec-1" }),
}));

vi.mock("@/hooks/use-recording-ws", () => ({
  useRecordingWs: () => wsState,
}));

vi.mock("@/hooks/use-recording-poller", () => ({
  useRecordingPoller: vi.fn(),
}));

vi.mock("@/lib/api-client", () => ({
  getRecording: vi.fn(),
  getAudioUrl: vi.fn((id: string) => `/api/files/${id}/audio`),
  triggerTranscribe: vi.fn(),
  getTranscription: vi.fn(),
}));

import { RecordingDetailPage } from "./recording-detail-page";
import { getRecording } from "@/lib/api-client";
import { useRecordingPoller } from "@/hooks/use-recording-poller";

const mockGetRecording = vi.mocked(getRecording);
const mockUseRecordingPoller = vi.mocked(useRecordingPoller);

function makeRecording(
  status: Recording["status"],
  overrides: Partial<Recording> = {},
): Recording {
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
    ...overrides,
  };
}

describe("RecordingDetailPage WS reconciliation", () => {
  beforeEach(() => {
    wsState.lastEvent = null;
    wsState.isConnected = true;
    mockGetRecording.mockReset();
    mockUseRecordingPoller.mockReset();
  });

  async function flushAsync(): Promise<void> {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows ERROR immediately when a failed WS event arrives", async () => {
    mockGetRecording
      .mockResolvedValueOnce({ ok: true, data: makeRecording("TRANSCRIBING") })
      // Keep refetch pending so we can assert the immediate local transition to ERROR.
      .mockImplementationOnce(
        () =>
          new Promise(() => {
            // Intentionally unresolved.
          }),
      );

    const { rerender } = render(<RecordingDetailPage />);
    await waitFor(() => {
      expect(screen.getByText("Trascrizione in corso…")).toBeTruthy();
    });

    wsState.lastEvent = {
      type: "failed",
      recordingId: "rec-1",
      error: "ASR failed from websocket",
    };
    rerender(<RecordingDetailPage />);

    await waitFor(() => {
      expect(screen.queryByText("Trascrizione in corso…")).toBeNull();
      expect(screen.getByText("Errore")).toBeTruthy();
      expect(screen.getByText("ASR failed from websocket")).toBeTruthy();
    });
  });

  it("retries refetch after failed WS events and eventually aligns with DB state", async () => {
    vi.useFakeTimers();

    mockGetRecording
      .mockResolvedValueOnce({ ok: true, data: makeRecording("TRANSCRIBING") })
      .mockResolvedValueOnce({
        ok: false,
        error: { kind: "network", message: "temporary failure" },
      })
      .mockResolvedValueOnce({
        ok: false,
        error: { kind: "network", message: "temporary failure" },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: makeRecording("ERROR", { errorMessage: "Canonical DB error" }),
      });

    const { rerender } = render(<RecordingDetailPage />);
    await flushAsync();
    expect(screen.getByText("Trascrizione in corso…")).toBeTruthy();

    wsState.lastEvent = {
      type: "failed",
      recordingId: "rec-1",
      error: "WS temporary error",
    };
    rerender(<RecordingDetailPage />);
    await flushAsync();

    // Immediate retry (delay 0ms)
    expect(mockGetRecording).toHaveBeenCalledTimes(2);

    // Second retry (+2000ms)
    await act(() => vi.advanceTimersByTimeAsync(2000));
    await flushAsync();
    expect(mockGetRecording).toHaveBeenCalledTimes(3);

    // Third retry (+2000ms)
    await act(() => vi.advanceTimersByTimeAsync(2000));
    await flushAsync();
    expect(mockGetRecording).toHaveBeenCalledTimes(4);
    expect(screen.getByText("Canonical DB error")).toBeTruthy();
  });

  it("shows a non-blocking warning after reconcile timeout and keeps refreshing", async () => {
    vi.useFakeTimers();

    mockGetRecording
      .mockResolvedValueOnce({ ok: true, data: makeRecording("TRANSCRIBING") })
      .mockResolvedValue({
        ok: false,
        error: { kind: "network", message: "temporary failure" },
      });

    const { rerender } = render(<RecordingDetailPage />);
    await flushAsync();

    wsState.lastEvent = {
      type: "failed",
      recordingId: "rec-1",
      error: "WS temporary error",
    };
    rerender(<RecordingDetailPage />);
    await flushAsync();

    await act(() => vi.advanceTimersByTimeAsync(30000));
    await flushAsync();

    expect(
      screen.getByText("Aggiornamento in real-time non disponibile. Continuiamo con refresh periodico."),
    ).toBeTruthy();
    const callsAfterTimeout = mockGetRecording.mock.calls.length;

    await act(() => vi.advanceTimersByTimeAsync(10000));
    await flushAsync();

    expect(mockGetRecording.mock.calls.length).toBe(callsAfterTimeout + 1);
  });

  it("uses polling fallback when websocket is disconnected", async () => {
    mockGetRecording.mockResolvedValue({ ok: true, data: makeRecording("TRANSCRIBING") });

    const { rerender } = render(<RecordingDetailPage />);
    await waitFor(() => {
      expect(screen.getByText("Trascrizione in corso…")).toBeTruthy();
    });

    expect(mockUseRecordingPoller).toHaveBeenCalledWith("rec-1", undefined, expect.any(Function));

    mockUseRecordingPoller.mockClear();
    wsState.isConnected = false;
    rerender(<RecordingDetailPage />);
    await flushAsync();

    expect(mockUseRecordingPoller).toHaveBeenCalledWith(
      "rec-1",
      "TRANSCRIBING",
      expect.any(Function),
    );
  });
});
