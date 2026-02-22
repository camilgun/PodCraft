import { useEffect, useRef } from "react";
import type { Recording } from "@podcraft/shared";
import { getRecording } from "@/lib/api-client";

const POLL_INTERVAL_MS = 2000;

/**
 * Polls GET /api/recordings/:id every 2s while status === "TRANSCRIBING".
 * Calls onUpdate with the fresh Recording on each successful fetch.
 * Stops automatically when the status leaves TRANSCRIBING, or on unmount.
 *
 * The onUpdate callback is captured in a ref so callers don't need to
 * wrap it in useCallback — changing the callback never restarts polling.
 */
export function useRecordingPoller(
  recordingId: string | undefined,
  currentStatus: Recording["status"] | undefined,
  onUpdate: (recording: Recording) => void,
): void {
  // Keep a stable ref to the latest callback without it being a dependency.
  const onUpdateRef = useRef(onUpdate);
  useEffect(() => {
    onUpdateRef.current = onUpdate;
  });

  useEffect(() => {
    if (!recordingId || currentStatus !== "TRANSCRIBING") return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function poll() {
      if (cancelled || !recordingId) return;

      const result = await getRecording(recordingId);
      if (cancelled) return;

      if (result.ok) {
        onUpdateRef.current(result.data);
        // Stop polling once the job is no longer running.
        if (result.data.status === "TRANSCRIBING") {
          timer = setTimeout(() => {
            void poll();
          }, POLL_INTERVAL_MS);
        }
      } else {
        // On transient network error, keep retrying.
        timer = setTimeout(() => {
          void poll();
        }, POLL_INTERVAL_MS);
      }
    }

    timer = setTimeout(() => {
      void poll();
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
    };
  }, [recordingId, currentStatus]);
}
