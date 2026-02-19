import { useState, useEffect, useCallback } from "react";
import type { Recording } from "@podcraft/shared";
import { getRecordings, triggerLibrarySync } from "@/lib/api-client";
import { RecordingCard } from "@/components/recording-card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

type LoadState =
  | { kind: "loading" }
  | { kind: "loaded"; recordings: Recording[] }
  | { kind: "error"; message: string };

const SYNC_REFRESH_DELAYS_MS = [0, 750, 1500] as const;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function LibraryPage() {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [isSyncing, setIsSyncing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const loadRecordings = useCallback(
    async (options: { showLoading?: boolean } = {}) => {
      const { showLoading = true } = options;
      if (showLoading) {
        setState({ kind: "loading" });
      }

      const result = await getRecordings();
      if (result.ok) {
        setState({ kind: "loaded", recordings: result.data });
      } else {
        setState({ kind: "error", message: result.error.message });
      }
    },
    []
  );

  const refreshRecordingsAfterSync = useCallback(async () => {
    for (const delayMs of SYNC_REFRESH_DELAYS_MS) {
      if (delayMs > 0) {
        await wait(delayMs);
      }
      await loadRecordings({ showLoading: false });
    }
  }, [loadRecordings]);

  async function handleSync() {
    setIsSyncing(true);
    setActionError(null);

    const result = await triggerLibrarySync();
    if (result.ok) {
      await refreshRecordingsAfterSync();
    } else {
      setState({ kind: "error", message: result.error.message });
    }

    setIsSyncing(false);
  }

  // Load existing DB data first, then trigger sync and refresh to catch new files.
  // The `cancelled` flag prevents React Strict Mode's double-invocation from firing
  // two syncs: the cleanup sets `cancelled = true` so the first async bails out
  // before calling triggerLibrarySync, leaving only the second (real) mount to sync.
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      await loadRecordings();
      if (cancelled) return;
      const syncResult = await triggerLibrarySync();
      if (syncResult.ok && !cancelled) {
        await refreshRecordingsAfterSync();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loadRecordings, refreshRecordingsAfterSync]);

  function handleTranscribeStart(id: string) {
    setActionError(null);
    setState((prev) => {
      if (prev.kind !== "loaded") return prev;
      return {
        kind: "loaded",
        recordings: prev.recordings.map((r) =>
          r.id === id ? { ...r, status: "TRANSCRIBING" as const } : r
        ),
      };
    });
  }

  function handleTranscribeError(message: string) {
    setActionError(`Unable to start transcription: ${message}`);
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b px-6 py-4">
        <div className="mx-auto max-w-5xl flex items-center justify-between">
          <h1 className="text-xl font-semibold tracking-tight">PodCraft</h1>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void handleSync();
            }}
            disabled={isSyncing || state.kind === "loading"}
          >
            {isSyncing ? "Syncing…" : "Sync Library"}
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        <h2 className="text-lg font-medium mb-6">
          Recordings
          {state.kind === "loaded" && (
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              ({state.recordings.length})
            </span>
          )}
        </h2>

        {actionError != null && (
          <div className="mb-6 rounded-lg border border-destructive/20 bg-destructive/5 p-4">
            <p className="text-sm font-medium text-destructive">{actionError}</p>
          </div>
        )}

        {state.kind === "loading" && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-48 rounded-lg" />
            ))}
          </div>
        )}

        {state.kind === "error" && (
          <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-6 text-center">
            <p className="font-medium text-destructive">
              Failed to load recordings
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {state.message}
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={() => {
                void loadRecordings();
              }}
            >
              Retry
            </Button>
          </div>
        )}

        {state.kind === "loaded" && state.recordings.length === 0 && (
          <div className="rounded-lg border border-dashed p-12 text-center">
            <p className="text-muted-foreground">No recordings found.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Add audio files to your recordings directory and click "Sync
              Library".
            </p>
          </div>
        )}

        {state.kind === "loaded" && state.recordings.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {state.recordings.map((recording) => (
              <RecordingCard
                key={recording.id}
                recording={recording}
                onTranscribeStart={handleTranscribeStart}
                onTranscribeError={handleTranscribeError}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
