import { describe, expect, it, vi } from "vitest";
import { WSContext } from "hono/ws";
import { WsManager } from "./ws.js";

interface TestClient {
  ws: WSContext;
  sendSpy: ReturnType<typeof vi.fn>;
  closeSpy: ReturnType<typeof vi.fn>;
}

function createClient(options?: { throwOnSend?: boolean }): TestClient {
  const sendSpy = vi.fn();
  const closeSpy = vi.fn();

  const ws = new WSContext({
    send: (data) => {
      sendSpy(data);
      if (options?.throwOnSend) {
        throw new Error("send failed");
      }
    },
    close: (code, reason) => {
      closeSpy(code, reason);
    },
    readyState: 1,
  });

  return { ws, sendSpy, closeSpy };
}

describe("WsManager", () => {
  it("connect + broadcast sends payload to the connected client", () => {
    const manager = new WsManager();
    const client = createClient();

    manager.connect("rec-001", client.ws);
    manager.broadcast("rec-001", {
      type: "progress",
      recordingId: "rec-001",
      step: "transcribing",
      percent: 0,
    });

    expect(client.sendSpy).toHaveBeenCalledOnce();
    const payload = JSON.parse(client.sendSpy.mock.calls[0]![0] as string) as Record<string, unknown>;
    expect(payload).toMatchObject({
      type: "progress",
      recordingId: "rec-001",
      step: "transcribing",
      percent: 0,
    });
  });

  it("disconnect removes the client from the recording room", () => {
    const manager = new WsManager();
    const client = createClient();

    manager.connect("rec-001", client.ws);
    manager.disconnect("rec-001", client.ws);
    manager.broadcast("rec-001", {
      type: "state_change",
      recordingId: "rec-001",
      newState: "TRANSCRIBED",
    });

    expect(client.sendSpy).not.toHaveBeenCalled();
  });

  it("broadcast reaches all clients connected to the same recording", () => {
    const manager = new WsManager();
    const firstClient = createClient();
    const secondClient = createClient();

    manager.connect("rec-001", firstClient.ws);
    manager.connect("rec-001", secondClient.ws);
    manager.broadcast("rec-001", {
      type: "state_change",
      recordingId: "rec-001",
      newState: "TRANSCRIBED",
    });

    expect(firstClient.sendSpy).toHaveBeenCalledOnce();
    expect(secondClient.sendSpy).toHaveBeenCalledOnce();
  });

  it("keeps recording rooms isolated by recordingId", () => {
    const manager = new WsManager();
    const roomOneClient = createClient();
    const roomTwoClient = createClient();

    manager.connect("rec-001", roomOneClient.ws);
    manager.connect("rec-002", roomTwoClient.ws);
    manager.broadcast("rec-001", {
      type: "progress",
      recordingId: "rec-001",
      step: "aligning",
      percent: 50,
    });

    expect(roomOneClient.sendSpy).toHaveBeenCalledOnce();
    expect(roomTwoClient.sendSpy).not.toHaveBeenCalled();
  });

  it("removes and closes stale clients when send throws", () => {
    const manager = new WsManager();
    const staleClient = createClient({ throwOnSend: true });
    const healthyClient = createClient();

    manager.connect("rec-001", staleClient.ws);
    manager.connect("rec-001", healthyClient.ws);

    manager.broadcast("rec-001", {
      type: "progress",
      recordingId: "rec-001",
      step: "transcribing",
      percent: 10,
    });
    manager.broadcast("rec-001", {
      type: "progress",
      recordingId: "rec-001",
      step: "transcribing",
      percent: 20,
    });

    expect(staleClient.sendSpy).toHaveBeenCalledTimes(1);
    expect(staleClient.closeSpy).toHaveBeenCalledOnce();
    expect(healthyClient.sendSpy).toHaveBeenCalledTimes(2);
  });

  it("throws an explicit error when payload validation fails", () => {
    const manager = new WsManager();
    const client = createClient();
    manager.connect("rec-001", client.ws);

    expect(() =>
      manager.broadcast("rec-001", {
        type: "progress",
        recordingId: "rec-001",
        percent: 101,
      }),
    ).toThrow("Invalid WS payload");
  });
});
