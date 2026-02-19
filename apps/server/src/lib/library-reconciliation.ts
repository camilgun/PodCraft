import type { RecordingStatus } from "@podcraft/shared";

export interface LibraryDiskFile {
  filePath: string;
  fileHash: string;
}

export interface LibraryRecordingIdentity {
  id: string;
  filePath: string;
  fileHash: string | null;
  status: RecordingStatus;
}

export interface LibraryMatch {
  recordingId: string;
  filePath: string;
  fileHash: string;
  reason: "path" | "hash";
}

export interface LibraryAmbiguousMatch {
  reason: "path" | "hash";
  filePath: string;
  fileHash: string;
  candidateRecordingIds: string[];
}

export interface LibraryReconciliationResult {
  matches: LibraryMatch[];
  newFiles: LibraryDiskFile[];
  ambiguousMatches: LibraryAmbiguousMatch[];
  unmatchedRecordingIds: string[];
}

function getAvailableIds(ids: ReadonlyArray<string>, matchedIds: ReadonlySet<string>): string[] {
  return ids.filter((id) => !matchedIds.has(id));
}

/**
 * Reconciliation strategy:
 * 1) Path-first match (deterministic, avoids hash collisions/duplicates side effects)
 * 2) Hash fallback only for FILE_MISSING rows
 * 3) Ambiguous hash/path candidates are reported, not auto-resolved
 */
export function reconcileLibraryFiles(
  diskFiles: ReadonlyArray<LibraryDiskFile>,
  recordings: ReadonlyArray<LibraryRecordingIdentity>
): LibraryReconciliationResult {
  const matchedRecordingIds = new Set<string>();
  const matches: LibraryMatch[] = [];
  const newFiles: LibraryDiskFile[] = [];
  const ambiguousMatches: LibraryAmbiguousMatch[] = [];

  const pathIndex = new Map<string, string[]>();
  const missingHashIndex = new Map<string, string[]>();

  for (const recording of recordings) {
    const existingPathIds = pathIndex.get(recording.filePath) ?? [];
    existingPathIds.push(recording.id);
    pathIndex.set(recording.filePath, existingPathIds);

    if (recording.status === "FILE_MISSING" && recording.fileHash !== null) {
      const existingHashIds = missingHashIndex.get(recording.fileHash) ?? [];
      existingHashIds.push(recording.id);
      missingHashIndex.set(recording.fileHash, existingHashIds);
    }
  }

  for (const file of diskFiles) {
    const pathCandidates = getAvailableIds(pathIndex.get(file.filePath) ?? [], matchedRecordingIds);
    if (pathCandidates.length === 1) {
      const [recordingId] = pathCandidates;
      if (recordingId === undefined) {
        continue;
      }

      matchedRecordingIds.add(recordingId);
      matches.push({
        recordingId,
        filePath: file.filePath,
        fileHash: file.fileHash,
        reason: "path"
      });
      continue;
    }

    if (pathCandidates.length > 1) {
      ambiguousMatches.push({
        reason: "path",
        filePath: file.filePath,
        fileHash: file.fileHash,
        candidateRecordingIds: [...pathCandidates].sort()
      });
      continue;
    }

    const hashCandidates = getAvailableIds(
      missingHashIndex.get(file.fileHash) ?? [],
      matchedRecordingIds
    );
    if (hashCandidates.length === 1) {
      const [recordingId] = hashCandidates;
      if (recordingId === undefined) {
        continue;
      }

      matchedRecordingIds.add(recordingId);
      matches.push({
        recordingId,
        filePath: file.filePath,
        fileHash: file.fileHash,
        reason: "hash"
      });
      continue;
    }

    if (hashCandidates.length > 1) {
      ambiguousMatches.push({
        reason: "hash",
        filePath: file.filePath,
        fileHash: file.fileHash,
        candidateRecordingIds: [...hashCandidates].sort()
      });
      continue;
    }

    newFiles.push(file);
  }

  const unmatchedRecordingIds = recordings
    .map((recording) => recording.id)
    .filter((recordingId) => !matchedRecordingIds.has(recordingId));

  return {
    matches,
    newFiles,
    ambiguousMatches,
    unmatchedRecordingIds
  };
}
