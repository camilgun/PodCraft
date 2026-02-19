import { useState, useEffect } from "react";
import { useParams, Link } from "react-router";
import { canStartTranscription, type Recording } from "@podcraft/shared";
import { getRecording, getAudioUrl, triggerTranscribe } from "@/lib/api-client";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDuration, formatDate, formatFileSize } from "@/lib/format";

type LoadState =
  | { kind: "loading" }
  | { kind: "loaded"; recording: Recording }
  | { kind: "error"; message: string };

export function RecordingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    void (async () => {
      const result = await getRecording(id);
      if (result.ok) {
        setState({ kind: "loaded", recording: result.data });
      } else {
        setState({ kind: "error", message: result.error.message });
      }
    })();
  }, [id]);

  async function handleTranscribeClick() {
    if (!id) return;
    const result = await triggerTranscribe(id);
    if (result.ok) {
      setActionError(null);
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

  const canTranscribe =
    state.kind === "loaded" && canStartTranscription(state.recording.status);

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
                <p className="mb-3 text-sm font-medium text-muted-foreground">
                  Audio Player
                </p>
                <audio
                  controls
                  className="w-full"
                  src={getAudioUrl(state.recording.id)}
                  preload="metadata"
                >
                  Il tuo browser non supporta l&apos;elemento audio.
                </audio>
              </div>
            )}

            {/* Actions */}
            {canTranscribe && (
              <div>
                {actionError != null && (
                  <div className="mb-3 rounded-lg border border-destructive/20 bg-destructive/5 p-3">
                    <p className="text-sm font-medium text-destructive">
                      {actionError}
                    </p>
                  </div>
                )}
                <Button
                  onClick={() => {
                    void handleTranscribeClick();
                  }}
                >
                  Trascrivi
                </Button>
              </div>
            )}

            {/* Metadata */}
            <div className="rounded-lg border bg-card p-4">
              <p className="mb-3 text-sm font-medium text-muted-foreground">
                Metadata
              </p>
              <dl className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
                <div>
                  <dt className="text-muted-foreground">Durata</dt>
                  <dd className="font-medium">
                    {formatDuration(state.recording.durationSeconds)}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Formato</dt>
                  <dd className="font-medium uppercase">
                    {state.recording.format}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Dimensione</dt>
                  <dd className="font-medium">
                    {formatFileSize(state.recording.fileSizeBytes)}
                  </dd>
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
                  <dd className="font-medium">
                    {formatDate(state.recording.createdAt)}
                  </dd>
                </div>
                {state.recording.languageDetected != null && (
                  <div>
                    <dt className="text-muted-foreground">Lingua</dt>
                    <dd className="font-medium">
                      {state.recording.languageDetected}
                    </dd>
                  </div>
                )}
              </dl>
            </div>

            {/* Error message */}
            {state.recording.status === "ERROR" &&
              state.recording.errorMessage != null && (
                <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4">
                  <p className="text-sm font-medium text-destructive">Errore</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {state.recording.errorMessage}
                  </p>
                </div>
              )}
          </div>
        )}
      </main>
    </div>
  );
}
