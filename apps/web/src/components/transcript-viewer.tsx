import { useEffect, useRef } from "react";
import type { AlignedSegment } from "@podcraft/shared";
import { cn } from "@/lib/utils";

interface TranscriptViewerProps {
  segments: AlignedSegment[];
  currentTime: number;
  onSeek: (time: number) => void;
}

function formatTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m)}:${String(s).padStart(2, "0")}`;
}

export function TranscriptViewer({ segments, currentTime, onSeek }: TranscriptViewerProps) {
  const activeRef = useRef<HTMLButtonElement | null>(null);

  let activeIndex = -1;
  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i]!;
    if (currentTime >= seg.startTime && currentTime <= seg.endTime) {
      activeIndex = i;
      break;
    }
  }

  useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [activeIndex]);

  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="mb-3 text-sm font-medium text-muted-foreground">Trascrizione</p>
      <div className="max-h-96 overflow-y-auto space-y-0.5">
        {segments.map((seg, i) => {
          const isActive = i === activeIndex;
          return (
            <button
              key={seg.id}
              ref={isActive ? activeRef : null}
              type="button"
              onClick={() => {
                onSeek(seg.startTime);
              }}
              className={cn(
                "w-full text-left text-sm rounded px-2 py-1.5 transition-colors cursor-pointer",
                "hover:bg-accent hover:text-accent-foreground",
                isActive
                  ? "bg-primary/10 text-primary font-medium"
                  : "text-foreground",
              )}
            >
              <span className="text-xs text-muted-foreground mr-2 font-mono shrink-0">
                {formatTimestamp(seg.startTime)}
              </span>
              {seg.text}
            </button>
          );
        })}
      </div>
    </div>
  );
}
