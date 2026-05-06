import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, Link } from "react-router";
import { canStartTranscription, type Recording, type Transcription } from "@podcraft/shared";
import { getRecording, getAudioUrl, triggerTranscribe, getTranscription } from "@/lib/api-client";
import { StatusBadge } from "@/components/status-badge";
import { TranscriptViewer } from "@/components/transcript-viewer";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useRecordingPoller } from "@/hooks/use-recording-poller";
import { useRecordingWs } from "@/hooks/use-recording-ws";
import { formatDuration, formatDate, formatFileSize } from "@/lib/format";

type LoadState =
  | { kind: "loading" }
  | { kind: "loaded"; recording: Recording }
  | { kind: "error"; message: string };

type TranscriptionState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "loaded"; transcription: Transcription }
  | { kind: "error"; message: string };

const RECONCILE_RETRY_INTERVAL_MS = 2000;
const RECONCILE_FALLBACK_INTERVAL_MS = 10000;
const RECONCILE_MAX_DURATION_MS = 30000;
const RECONCILE_WARNING_MESSAGE =
  "Aggiornamento in real-time non disponibile. Continuiamo con refresh periodico.";

export function RecordingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [transcriptionState, setTranscriptionState] = useState<TranscriptionState>({
    kind: "idle",
  });
  const [actionError, setActionError] = useState<string | null>(null);
  const [reconcileWarning, setReconcileWarning] = useState<string | null>(null);
  const [needsReconcile, setNeedsReconcile] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const activeWsJobIdRef = useRef<string | null>(null);

  // Reset page-local state when route param changes.
  useEffect(() => {
    setTranscriptionState({ kind: "idle" });
    setActionError(null);
    setReconcileWarning(null);
    setNeedsReconcile(false);
    setCurrentTime(0);
    activeWsJobIdRef.current = null;
  }, [id]);

  // Initial recording load
  useEffect(() => {
    if (!id) {
      setState({ kind: "error", message: "Recording ID not provided" });
      return;
    }

    setState({ kind: "loading" });
    let cancelled = false;

    void (async () => {
      const result = await getRecording(id);
      if (cancelled) return;

      if (result.ok) {
        setState({ kind: "loaded", recording: result.data });
      } else {
        setState({ kind: "error", message: result.error.message });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [id]);

  const currentRecording = state.kind === "loaded" ? state.recording : undefined;
  const { lastEvent, isConnected } = useRecordingWs(id);

  // Stable callback for the poller
  const handleRecordingUpdate = useCallback((recording: Recording) => {
    setState({ kind: "loaded", recording });
  }, []);

  // Keep track of the active WS job id when available.
  useEffect(() => {
    if (!lastEvent?.jobId) return;
    if (lastEvent.type !== "progress" || lastEvent.step !== "transcribing") return;
    activeWsJobIdRef.current = lastEvent.jobId;
  }, [lastEvent]);

  // Mark the page as needing reconciliation when WS reports terminal events.
  useEffect(() => {
    if (!id || !lastEvent) return;
    if (lastEvent.type !== "state_change" && lastEvent.type !== "failed") return;

    const eventJobId = lastEvent.jobId;
    const activeJobId = activeWsJobIdRef.current;
    if (eventJobId != null && activeJobId != null && eventJobId !== activeJobId) {
      return;
    }
    if (eventJobId != null && activeJobId == null) {
      activeWsJobIdRef.current = eventJobId;
    }

    setReconcileWarning(null);
    setNeedsReconcile(true);
  }, [id, lastEvent]);

  // Reconcile with canonical DB state until a successful refetch occurs.
  // This runs independently of isConnected because an open socket does not
  // guarantee event delivery.
  useEffect(() => {
    if (!id || !needsReconcile) return;
    const activeRecordingId = id;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const startedAt = Date.now();

    async function runAttempt() {
      if (cancelled) return;

      const result = await getRecording(activeRecordingId);
      if (cancelled) return;

      if (result.ok) {
        handleRecordingUpdate(result.data);
        if (result.data.status !== "TRANSCRIBING") {
          activeWsJobIdRef.current = null;
        }
        setNeedsReconcile(false);
        setReconcileWarning(null);
        return;
      }

      const elapsedMs = Date.now() - startedAt;
      const pastMaxDuration = elapsedMs >= RECONCILE_MAX_DURATION_MS;
      if (pastMaxDuration) {
        setReconcileWarning(RECONCILE_WARNING_MESSAGE);
      }
      const delayMs = pastMaxDuration
        ? RECONCILE_FALLBACK_INTERVAL_MS
        : RECONCILE_RETRY_INTERVAL_MS;

      timer = setTimeout(() => {
        void runAttempt();
      }, delayMs);
    }

    void runAttempt();

    return () => {
      cancelled = true;
      if (timer !== null) {
        clearTimeout(timer);
      }
    };
  }, [id, needsReconcile, handleRecordingUpdate]);

  // Poll while TRANSCRIBING only when WS is not connected (fallback mode).
  useRecordingPoller(id, isConnected ? undefined : currentRecording?.status, handleRecordingUpdate);

  // Load transcript when recording reaches TRANSCRIBED
  useEffect(() => {
    if (!id || currentRecording?.status !== "TRANSCRIBED") return;
    if (
      transcriptionState.kind === "loaded" ||
      transcriptionState.kind === "loading" ||
      transcriptionState.kind === "error" // Previene il retry loop infinito
    ) {
      return;
    }

    setTranscriptionState({ kind: "loading" });
    void (async () => {
      const result = await getTranscription(id);
      if (result.ok) {
        setTranscriptionState({ kind: "loaded", transcription: result.data });
      } else {
        setTranscriptionState({ kind: "error", message: result.error.message });
      }
    })();
  }, [id, currentRecording?.status, transcriptionState.kind]);

  async function handleTranscribeClick() {
    if (!id) return;
    const result = await triggerTranscribe(id);
    if (result.ok) {
      setActionError(null);
      // Reset transcript so it reloads when the new transcription completes.
      setTranscriptionState({ kind: "idle" });
      activeWsJobIdRef.current = null;
      setState((prev) => {
        if (prev.kind !== "loaded") return prev;
        return {
          kind: "loaded",
          recording: { ...prev.recording, status: "TRANSCRIBING" as const },
        };
      });
      return;
    }
    setActionError(`Unable to start transcription: ${result.error.message}`);
  }

  function handleRetranscribeClick() {
    const confirmed = window.confirm(
      "Esiste già una trascrizione per questa registrazione. Vuoi rilanciarla?",
    );
    if (confirmed) {
      void handleTranscribeClick();
    }
  }

  function handleSeek(time: number) {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = time;
    void audio.play();
  }

  const canTranscribe = state.kind === "loaded" && canStartTranscription(state.recording.status);
  const canRetranscribe =
    state.kind === "loaded" && state.recording.status === "TRANSCRIBED";
  const isTranscribing = state.kind === "loaded" && state.recording.status === "TRANSCRIBING";

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b px-6 py-4">
        <div className="mx-auto max-w-3xl flex items-center gap-4">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/">← Library</Link>
          </Button>
          <h1 className="text-lg font-semibold">Recording Detail</h1>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-8">
        {state.kind === "loading" && (
          <div className="space-y-4">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        )}

        {state.kind === "error" && (
          <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-6">
            <p className="font-medium text-destructive">{state.message}</p>
            <Button variant="outline" size="sm" className="mt-4" asChild>
              <Link to="/">Back to Library</Link>
            </Button>
          </div>
        )}

        {state.kind === "loaded" && (
          <div className="space-y-6">
            <div className="flex items-start justify-between gap-4">
              <h2 className="text-xl font-semibold break-all">
                {state.recording.originalFilename}
              </h2>
              <div className="shrink-0 flex items-center gap-2">
                <StatusBadge status={state.recording.status} />
              </div>
            </div>

            {/* Audio player */}
            {state.recording.status !== "FILE_MISSING" && (
              <div className="rounded-lg border bg-card p-4">
                <p className="mb-3 text-sm font-medium text-muted-foreground">Audio Player</p>
                <audio
                  ref={audioRef}
                  controls
                  className="w-full"
                  src={getAudioUrl(state.recording.id)}
                  preload="metadata"
                  onTimeUpdate={(e) => {
                    setCurrentTime(e.currentTarget.currentTime);
                  }}
                >
                  Il tuo browser non supporta l&apos;elemento audio.
                </audio>
              </div>
            )}

            {/* Progress indicator */}
            {isTranscribing && (
              <div className="rounded-lg border bg-card p-4 flex items-center gap-3">
                <div className="h-4 w-4 rounded-full border-2 border-primary border-t-transparent animate-spin shrink-0" />
                <p className="text-sm text-muted-foreground">Trascrizione in corso…</p>
              </div>
            )}
            {reconcileWarning != null && (
              <div className="rounded-lg border bg-muted/40 p-4">
                <p className="text-sm text-muted-foreground">{reconcileWarning}</p>
              </div>
            )}

            {/* Transcript */}
            {transcriptionState.kind === "loading" && (
              <Skeleton className="h-48 w-full rounded-lg" />
            )}
            {transcriptionState.kind === "loaded" && (
              <TranscriptViewer
                segments={transcriptionState.transcription.segments}
                currentTime={currentTime}
                onSeek={handleSeek}
              />
            )}
            {transcriptionState.kind === "error" && (
              <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4">
                <p className="text-sm text-destructive">
                  Errore nel caricamento della trascrizione: {transcriptionState.message}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  onClick={() => setTranscriptionState({ kind: "idle" })}
                >
                  Riprova a caricare
                </Button>
              </div>
            )}

            {/* Actions */}
            {(canTranscribe || canRetranscribe) && (
              <div>
                {actionError != null && (
                  <div className="mb-3 rounded-lg border border-destructive/20 bg-destructive/5 p-3">
                    <p className="text-sm font-medium text-destructive">{actionError}</p>
                  </div>
                )}
                {canTranscribe && (
                  <Button
                    onClick={() => {
                      void handleTranscribeClick();
                    }}
                  >
                    Trascrivi
                  </Button>
                )}
                {canRetranscribe && (
                  <Button variant="outline" onClick={handleRetranscribeClick}>
                    Ritrascrivi
                  </Button>
                )}
              </div>
            )}

            {/* Metadata */}
            <div className="rounded-lg border bg-card p-4">
              <p className="mb-3 text-sm font-medium text-muted-foreground">Metadata</p>
              <dl className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
                <div>
                  <dt className="text-muted-foreground">Durata</dt>
                  <dd className="font-medium">{formatDuration(state.recording.durationSeconds)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Formato</dt>
                  <dd className="font-medium uppercase">{state.recording.format}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Dimensione</dt>
                  <dd className="font-medium">{formatFileSize(state.recording.fileSizeBytes)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Sample Rate</dt>
                  <dd className="font-medium">
                    {(state.recording.sampleRate / 1000).toFixed(1)} kHz
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Canali</dt>
                  <dd className="font-medium">
                    {state.recording.channels === 1 ? "Mono" : "Stereo"}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Aggiunto il</dt>
                  <dd className="font-medium">{formatDate(state.recording.createdAt)}</dd>
                </div>
                {state.recording.recordedAt != null && (
                  <div>
                    <dt className="text-muted-foreground">Registrato il</dt>
                    <dd className="font-medium">{formatDate(state.recording.recordedAt)}</dd>
                  </div>
                )}
                {state.recording.languageDetected != null && (
                  <div>
                    <dt className="text-muted-foreground">Lingua</dt>
                    <dd className="font-medium">{state.recording.languageDetected}</dd>
                  </div>
                )}
              </dl>
            </div>

            {/* Error message */}
            {state.recording.status === "ERROR" && state.recording.errorMessage != null && (
              <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4">
                <p className="text-sm font-medium text-destructive">Errore</p>
                <p className="mt-1 text-sm text-muted-foreground">{state.recording.errorMessage}</p>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
