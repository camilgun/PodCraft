import { canTransition, type RecordingStatus } from "@podcraft/shared";

export interface MissingTransitionCandidate {
  id: string;
  filePath: string;
  status: RecordingStatus;
}

export interface ProbeFailureGuardInput {
  discoveredAudioFileCount: number;
  successfulProbeCount: number;
  failedProbeCount: number;
}

/**
 * Returns the subset of unmatched recording IDs that should transition to FILE_MISSING.
 *
 * Guardrail: if a file path was discovered on disk in this sync cycle but failed
 * probe/hash, it must not be marked FILE_MISSING (it's present, just temporarily unreadable).
 */
export function selectRecordingsToMarkMissing(
  unmatchedRecordingIds: ReadonlyArray<string>,
  candidates: ReadonlyArray<MissingTransitionCandidate>,
  discoveredFilePaths: ReadonlySet<string>
): string[] {
  if (unmatchedRecordingIds.length === 0) {
    return [];
  }

  const unmatchedSet = new Set(unmatchedRecordingIds);

  return candidates
    .filter((candidate) => unmatchedSet.has(candidate.id))
    .filter((candidate) => !discoveredFilePaths.has(candidate.filePath))
    .filter((candidate) => canTransition(candidate.status, "FILE_MISSING"))
    .map((candidate) => candidate.id);
}

/**
 * Abort sync when discovered audio files all failed probe/hash.
 * This usually indicates a systemic issue (ffprobe missing, permissions, etc.)
 * and applying partial state transitions would be unsafe.
 */
export function shouldAbortSyncForProbeFailures(input: ProbeFailureGuardInput): boolean {
  const { discoveredAudioFileCount, successfulProbeCount, failedProbeCount } = input;

  return discoveredAudioFileCount > 0 && failedProbeCount > 0 && successfulProbeCount === 0;
}
