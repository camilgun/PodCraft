import type { RecordingStatus } from "@podcraft/shared";
import { Badge } from "@/components/ui/badge";

const STATUS_LABELS: Record<RecordingStatus, string> = {
  IMPORTED: "Imported",
  TRANSCRIBING: "Transcribing…",
  TRANSCRIBED: "Transcribed",
  ANALYZING: "Analyzing…",
  REVIEWED: "Reviewed",
  EXPORTING: "Exporting…",
  COMPLETED: "Completed",
  ERROR: "Error",
  FILE_MISSING: "File Missing",
};

const STATUS_VARIANT: Record<RecordingStatus, "default" | "secondary" | "destructive" | "outline"> =
  {
    IMPORTED: "secondary",
    TRANSCRIBING: "default",
    TRANSCRIBED: "default",
    ANALYZING: "default",
    REVIEWED: "default",
    EXPORTING: "default",
    COMPLETED: "default",
    ERROR: "destructive",
    FILE_MISSING: "destructive",
  };

interface StatusBadgeProps {
  status: RecordingStatus;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  return <Badge variant={STATUS_VARIANT[status]}>{STATUS_LABELS[status]}</Badge>;
}
