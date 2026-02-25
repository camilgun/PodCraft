import { wsProgressEventSchema, type WsProgressEvent } from "@podcraft/shared";
import type { WSContext } from "hono/ws";

export class WsManager {
  private readonly clientsByRecordingId = new Map<string, Set<WSContext>>();

  connect(recordingId: string, ws: WSContext): void {
    const clientsForRecording = this.clientsByRecordingId.get(recordingId);
    if (clientsForRecording) {
      clientsForRecording.add(ws);
      return;
    }

    this.clientsByRecordingId.set(recordingId, new Set([ws]));
  }

  disconnect(recordingId: string, ws: WSContext): void {
    const clientsForRecording = this.clientsByRecordingId.get(recordingId);
    if (!clientsForRecording) {
      return;
    }

    clientsForRecording.delete(ws);
    if (clientsForRecording.size === 0) {
      this.clientsByRecordingId.delete(recordingId);
    }
  }

  broadcast(recordingId: string, event: WsProgressEvent): void {
    const parsed = wsProgressEventSchema.safeParse(event);
    if (!parsed.success) {
      throw new Error(`Invalid WS payload: ${parsed.error.message}`);
    }

    if (parsed.data.recordingId !== recordingId) {
      throw new Error("WS payload recordingId mismatch");
    }

    const clientsForRecording = this.clientsByRecordingId.get(recordingId);
    if (!clientsForRecording || clientsForRecording.size === 0) {
      return;
    }

    const serializedPayload = JSON.stringify(parsed.data);
    const staleClients: WSContext[] = [];

    for (const ws of clientsForRecording) {
      try {
        ws.send(serializedPayload);
      } catch {
        staleClients.push(ws);
        try {
          ws.close(1011, "WebSocket send failed");
        } catch {
          // Ignore close failures while cleaning up stale clients.
        }
      }
    }

    for (const staleClient of staleClients) {
      this.disconnect(recordingId, staleClient);
    }
  }
}

export const wsManager = new WsManager();
