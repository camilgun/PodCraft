import { wsProgressEventSchema, type WsProgressEvent } from "@podcraft/shared";
import { useEffect, useRef, useState } from "react";
import { getRecordingWsUrl } from "@/lib/api-client";

const MAX_RECONNECT_ATTEMPTS = 3;
const RECONNECT_DELAYS_MS = [1000, 2000, 4000] as const;

export function useRecordingWs(
  recordingId: string | undefined,
): { lastEvent: WsProgressEvent | null; isConnected: boolean } {
  const [lastEvent, setLastEvent] = useState<WsProgressEvent | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  const socketRef = useRef<WebSocket | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const manualCloseRef = useRef(false);

  useEffect(() => {
    if (!recordingId) {
      setIsConnected(false);
      setLastEvent(null);
      return;
    }
    const activeRecordingId = recordingId;

    manualCloseRef.current = false;
    reconnectAttemptRef.current = 0;
    setIsConnected(false);
    setLastEvent(null);

    function clearReconnectTimer() {
      if (reconnectTimerRef.current === null) return;
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }

    function closeCurrentSocket() {
      const socket = socketRef.current;
      socketRef.current = null;
      if (socket) {
        socket.close();
      }
    }

    function scheduleReconnect(connect: () => void) {
      if (manualCloseRef.current) return;
      if (reconnectTimerRef.current !== null) return;
      if (reconnectAttemptRef.current >= MAX_RECONNECT_ATTEMPTS) return;

      const delay =
        RECONNECT_DELAYS_MS[reconnectAttemptRef.current] ??
        RECONNECT_DELAYS_MS[RECONNECT_DELAYS_MS.length - 1];
      reconnectAttemptRef.current += 1;

      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null;
        connect();
      }, delay);
    }

    function connect() {
      if (manualCloseRef.current) return;

      clearReconnectTimer();

      const socket = new WebSocket(getRecordingWsUrl(activeRecordingId));
      socketRef.current = socket;

      socket.onopen = () => {
        setIsConnected(true);
        reconnectAttemptRef.current = 0;
        clearReconnectTimer();
      };

      socket.onmessage = (event) => {
        if (typeof event.data !== "string") return;

        let rawPayload: unknown;
        try {
          rawPayload = JSON.parse(event.data) as unknown;
        } catch {
          return;
        }

        const parsed = wsProgressEventSchema.safeParse(rawPayload);
        if (!parsed.success) return;
        if (parsed.data.recordingId !== activeRecordingId) return;

        // Cast is safe: Zod validated the payload. Needed for
        // exactOptionalPropertyTypes compatibility with shared interface types.
        setLastEvent(parsed.data as WsProgressEvent);
      };

      const handleDisconnect = () => {
        if (socketRef.current !== socket) return;

        socketRef.current = null;
        setIsConnected(false);
        scheduleReconnect(connect);
      };

      socket.onerror = () => {
        handleDisconnect();
      };

      socket.onclose = () => {
        handleDisconnect();
      };
    }

    connect();

    return () => {
      manualCloseRef.current = true;
      clearReconnectTimer();
      closeCurrentSocket();
      setIsConnected(false);
    };
  }, [recordingId]);

  return { lastEvent, isConnected };
}
