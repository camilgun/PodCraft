import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useRecordingWs } from "./use-recording-ws";

const WS_CONNECTING = 0;
const WS_OPEN = 1;
const WS_CLOSING = 2;
const WS_CLOSED = 3;

class FakeWebSocket {
  static readonly CONNECTING = WS_CONNECTING;
  static readonly OPEN = WS_OPEN;
  static readonly CLOSING = WS_CLOSING;
  static readonly CLOSED = WS_CLOSED;
  static instances: FakeWebSocket[] = [];

  readonly url: string;
  readyState = WS_CONNECTING;
  closeCalls = 0;

  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(url: string | URL) {
    this.url = String(url);
    FakeWebSocket.instances.push(this);
  }

  static reset() {
    FakeWebSocket.instances = [];
  }

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    void data;
  }

  close(code?: number, reason?: string): void {
    void code;
    void reason;
    this.closeCalls += 1;
    this.readyState = WS_CLOSED;
  }

  emitOpen(): void {
    this.readyState = WS_OPEN;
    this.onopen?.(new Event("open"));
  }

  emitMessage(payload: unknown): void {
    this.onmessage?.(
      new MessageEvent("message", {
        data: JSON.stringify(payload),
      }),
    );
  }

  emitRawMessage(rawPayload: unknown): void {
    this.onmessage?.(
      new MessageEvent("message", {
        data: rawPayload,
      }),
    );
  }

  emitClose(): void {
    this.readyState = WS_CLOSED;
    this.onclose?.(new CloseEvent("close"));
  }
}

describe("useRecordingWs", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeWebSocket.reset();
    vi.stubGlobal("WebSocket", FakeWebSocket as unknown as typeof WebSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("opens a websocket with the expected URL when recordingId is provided", () => {
    renderHook(() => useRecordingWs("rec-1"));

    expect(FakeWebSocket.instances).toHaveLength(1);
    const ws = FakeWebSocket.instances[0];
    expect(ws).toBeDefined();

    const expectedUrl =
      `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/api/recordings/rec-1/ws`;
    expect(ws?.url).toBe(expectedUrl);
  });

  it("does not open a websocket when recordingId is undefined", () => {
    const { result } = renderHook(() => useRecordingWs(undefined));

    expect(FakeWebSocket.instances).toHaveLength(0);
    expect(result.current.isConnected).toBe(false);
    expect(result.current.lastEvent).toBeNull();
  });

  it("updates connection state on open and close", () => {
    const { result } = renderHook(() => useRecordingWs("rec-1"));
    const ws = FakeWebSocket.instances[0];
    expect(ws).toBeDefined();

    act(() => {
      ws?.emitOpen();
    });
    expect(result.current.isConnected).toBe(true);

    act(() => {
      ws?.emitClose();
    });
    expect(result.current.isConnected).toBe(false);
  });

  it("stores lastEvent when receiving a valid WS payload", () => {
    const { result } = renderHook(() => useRecordingWs("rec-1"));
    const ws = FakeWebSocket.instances[0];
    expect(ws).toBeDefined();

    act(() => {
      ws?.emitMessage({
        type: "state_change",
        recordingId: "rec-1",
        newState: "TRANSCRIBED",
      });
    });

    expect(result.current.lastEvent).toEqual({
      type: "state_change",
      recordingId: "rec-1",
      newState: "TRANSCRIBED",
    });
  });

  it("ignores invalid JSON and schema-invalid payloads", () => {
    const { result } = renderHook(() => useRecordingWs("rec-1"));
    const ws = FakeWebSocket.instances[0];
    expect(ws).toBeDefined();

    act(() => {
      ws?.emitRawMessage("{invalid json");
      ws?.emitMessage({
        type: "progress",
        recordingId: "rec-1",
        percent: 101,
      });
    });

    expect(result.current.lastEvent).toBeNull();
  });

  it("closes the websocket during cleanup", () => {
    const { unmount } = renderHook(() => useRecordingWs("rec-1"));
    const ws = FakeWebSocket.instances[0];
    expect(ws).toBeDefined();
    expect(ws?.closeCalls).toBe(0);

    unmount();
    expect(ws?.closeCalls).toBe(1);
  });

  it("reconnects with backoff 1s, 2s, 4s and stops after 3 retries", async () => {
    renderHook(() => useRecordingWs("rec-1"));

    const firstWs = FakeWebSocket.instances[0];
    expect(firstWs).toBeDefined();

    act(() => {
      firstWs?.emitClose();
    });

    await act(() => vi.advanceTimersByTimeAsync(999));
    expect(FakeWebSocket.instances).toHaveLength(1);
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(FakeWebSocket.instances).toHaveLength(2);

    const secondWs = FakeWebSocket.instances[1];
    expect(secondWs).toBeDefined();
    act(() => {
      secondWs?.emitClose();
    });
    await act(() => vi.advanceTimersByTimeAsync(1999));
    expect(FakeWebSocket.instances).toHaveLength(2);
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(FakeWebSocket.instances).toHaveLength(3);

    const thirdWs = FakeWebSocket.instances[2];
    expect(thirdWs).toBeDefined();
    act(() => {
      thirdWs?.emitClose();
    });
    await act(() => vi.advanceTimersByTimeAsync(3999));
    expect(FakeWebSocket.instances).toHaveLength(3);
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(FakeWebSocket.instances).toHaveLength(4);

    const fourthWs = FakeWebSocket.instances[3];
    expect(fourthWs).toBeDefined();
    act(() => {
      fourthWs?.emitClose();
    });
    await act(() => vi.advanceTimersByTimeAsync(8000));
    expect(FakeWebSocket.instances).toHaveLength(4);
  });

  it("resets reconnect attempts after a successful connection", async () => {
    renderHook(() => useRecordingWs("rec-1"));

    const firstWs = FakeWebSocket.instances[0];
    expect(firstWs).toBeDefined();
    act(() => {
      firstWs?.emitClose();
    });

    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(FakeWebSocket.instances).toHaveLength(2);

    const secondWs = FakeWebSocket.instances[1];
    expect(secondWs).toBeDefined();
    act(() => {
      secondWs?.emitOpen();
      secondWs?.emitClose();
    });

    await act(() => vi.advanceTimersByTimeAsync(999));
    expect(FakeWebSocket.instances).toHaveLength(2);
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(FakeWebSocket.instances).toHaveLength(3);
  });
});
