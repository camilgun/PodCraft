import type { MouseEvent, KeyboardEvent } from "react";
import { useNavigate } from "react-router";
import { canStartTranscription, type Recording } from "@podcraft/shared";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { formatDuration, formatDate, formatFileSize } from "@/lib/format";
import { triggerTranscribe } from "@/lib/api-client";

interface RecordingCardProps {
  recording: Recording;
  onTranscribeStart: (id: string) => void;
  onTranscribeError: (message: string) => void;
}

export function RecordingCard({
  recording,
  onTranscribeStart,
  onTranscribeError,
}: RecordingCardProps) {
  const navigate = useNavigate();

  function handleCardClick() {
    void navigate(`/recordings/${recording.id}`);
  }

  function handleCardKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleCardClick();
    }
  }

  async function handleTranscribeClick(e: MouseEvent) {
    e.stopPropagation();
    const result = await triggerTranscribe(recording.id);
    if (result.ok) {
      onTranscribeStart(recording.id);
      return;
    }
    onTranscribeError(result.error.message);
  }

  const canTranscribe = canStartTranscription(recording.status);

  return (
      <Card
        className="cursor-pointer hover:shadow-md transition-shadow"
        onClick={handleCardClick}
        onKeyDown={handleCardKeyDown}
        role="button"
        tabIndex={0}
      >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base font-medium leading-tight line-clamp-2">
            {recording.originalFilename}
          </CardTitle>
          <div className="shrink-0">
            <StatusBadge status={recording.status} />
          </div>
        </div>
      </CardHeader>
      <CardContent className="pb-2">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <div>
            <dt className="inline">Duration: </dt>
            <dd className="inline font-medium text-foreground">
              {formatDuration(recording.durationSeconds)}
            </dd>
          </div>
          <div>
            <dt className="inline">Format: </dt>
            <dd className="inline font-medium text-foreground uppercase">
              {recording.format}
            </dd>
          </div>
          <div>
            <dt className="inline">Size: </dt>
            <dd className="inline font-medium text-foreground">
              {formatFileSize(recording.fileSizeBytes)}
            </dd>
          </div>
          <div>
            <dt className="inline">Added: </dt>
            <dd className="inline font-medium text-foreground">
              {formatDate(recording.createdAt)}
            </dd>
          </div>
        </dl>
        {recording.status === "ERROR" && recording.errorMessage != null && (
          <p className="mt-2 text-xs text-destructive truncate">
            {recording.errorMessage}
          </p>
        )}
      </CardContent>
      {canTranscribe && (
        <CardFooter>
          <Button
            size="sm"
            variant="outline"
            onClick={(e) => {
              void handleTranscribeClick(e);
            }}
          >
            Trascrivi
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}
