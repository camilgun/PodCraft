import type { RecordingStatus } from "./types.js";

/**
 * Valid state transitions for a Recording.
 *
 * Rules from architecture-doc.md:
 * - Any state → ERROR (job failures)
 * - Any state → FILE_MISSING (Library Sync cannot find the file on disk)
 * - ERROR → the last "action" states (retry)
 * - FILE_MISSING → IMPORTED (Library Sync finds the file again, possibly at a new path)
 * - TRANSCRIBED → TRANSCRIBING (re-transcribe)
 * - REVIEWED → ANALYZING (re-analyze)
 * - COMPLETED → REVIEWED (back to review)
 */
export const VALID_TRANSITIONS: Readonly<
  Record<RecordingStatus, ReadonlyArray<RecordingStatus>>
> = {
  IMPORTED: ["TRANSCRIBING", "ERROR", "FILE_MISSING"],
  TRANSCRIBING: ["TRANSCRIBED", "TRANSCRIBING", "ERROR", "FILE_MISSING"],
  TRANSCRIBED: ["ANALYZING", "TRANSCRIBING", "ERROR", "FILE_MISSING"],
  ANALYZING: ["REVIEWED", "ANALYZING", "ERROR", "FILE_MISSING"],
  REVIEWED: ["EXPORTING", "ANALYZING", "ERROR", "FILE_MISSING"],
  EXPORTING: ["COMPLETED", "ERROR", "FILE_MISSING"],
  COMPLETED: ["REVIEWED", "ERROR", "FILE_MISSING"],
  ERROR: ["TRANSCRIBING", "ANALYZING", "EXPORTING", "FILE_MISSING"],
  FILE_MISSING: ["IMPORTED"]
};

/**
 * Returns true if transitioning from `from` to `to` is a valid state change.
 */
export function canTransition(from: RecordingStatus, to: RecordingStatus): boolean {
  return VALID_TRANSITIONS[from].includes(to);
}
