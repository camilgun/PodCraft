import { randomUUID } from "node:crypto";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { eq, inArray } from "drizzle-orm";
import { SUPPORTED_AUDIO_FORMATS, type RecordingStatus } from "@podcraft/shared";
import { db } from "../db/index.js";
import { recordings } from "../db/schema.js";
import { computeFileHash } from "../lib/file-hash.js";
import { probeAudioFile } from "../lib/ffprobe.js";
import {
  reconcileLibraryFiles,
  type LibraryDiskFile,
  type LibraryRecordingIdentity,
} from "../lib/library-reconciliation.js";
import {
  selectRecordingsToMarkMissing,
  shouldAbortSyncForProbeFailures,
  type MissingTransitionCandidate,
} from "../lib/library-sync-decisions.js";
import { config } from "../config.js";

export interface LibrarySyncSummary {
  newCount: number;
  updatedCount: number;
  missingCount: number;
  ambiguousCount: number;
  failedCount: number;
}

/**
 * Scans RECORDINGS_DIR, fingerprints every audio file, reconciles against the
 * DB, and applies all mutations in a single transaction.
 */
export async function runLibrarySync(): Promise<LibrarySyncSummary> {
  const dir = config.recordingsDir;

  // 1. Ensure the directory exists
  try {
    await stat(dir);
  } catch {
    throw new Error(`RECORDINGS_DIR does not exist or is not accessible: "${dir}"`);
  }

  // 2. Scan the directory (flat, non-recursive)
  const supportedExtensions = new Set(SUPPORTED_AUDIO_FORMATS.map((f) => `.${f}`));
  const entries = await readdir(dir, { withFileTypes: true });
  const audioFiles = entries
    .filter((entry) => entry.isFile() && supportedExtensions.has(getExtension(entry.name)))
    .map((entry) => join(dir, entry.name));
  const discoveredAudioPaths = new Set(audioFiles);
  const failedPaths = new Set<string>();

  // 3. Probe + fingerprint each file (sequentially to avoid overloading the fs)
  const diskFiles: (LibraryDiskFile & {
    durationSeconds: number;
    sampleRate: number;
    channels: number;
    format: "wav" | "mp3" | "m4a" | "flac" | "ogg";
    fileSizeBytes: number;
    originalFilename: string;
  })[] = [];

  for (const filePath of audioFiles) {
    try {
      const metadata = await probeAudioFile(filePath);
      const fileHash = await computeFileHash(filePath, metadata.fileSizeBytes);

      diskFiles.push({
        filePath,
        fileHash,
        originalFilename: getBasename(filePath),
        ...metadata,
      });
    } catch (err) {
      failedPaths.add(filePath);
      console.error(`[library-sync] Skipping "${filePath}": ${String(err)}`);
    }
  }

  if (
    shouldAbortSyncForProbeFailures({
      discoveredAudioFileCount: audioFiles.length,
      successfulProbeCount: diskFiles.length,
      failedProbeCount: failedPaths.size,
    })
  ) {
    throw new Error(
      `Library sync aborted: failed to probe/hash all ${failedPaths.size} discovered audio files.`,
    );
  }

  // 4. Load all recordings from DB
  const dbRows = await db
    .select({
      id: recordings.id,
      filePath: recordings.filePath,
      fileHash: recordings.fileHash,
      status: recordings.status,
    })
    .from(recordings);

  const dbIdentities: LibraryRecordingIdentity[] = dbRows.map((row) => ({
    id: row.id,
    filePath: row.filePath,
    fileHash: row.fileHash,
    status: row.status as RecordingStatus,
  }));
  const missingTransitionCandidates: MissingTransitionCandidate[] = dbRows.map((row) => ({
    id: row.id,
    filePath: row.filePath,
    status: row.status as RecordingStatus,
  }));

  // Build maps for retrocompat lookup (fileHash null check) and status reset
  const dbHashMap = new Map(dbRows.map((row) => [row.id, row.fileHash]));
  const dbStatusMap = new Map(dbRows.map((row) => [row.id, row.status as RecordingStatus]));

  // 5. Reconcile
  const reconciliation = reconcileLibraryFiles(diskFiles, dbIdentities);

  const now = new Date().toISOString();
  let newCount = 0;
  let updatedCount = 0;
  let missingCount = 0;

  // 6. Apply mutations in a transaction
  db.transaction((tx) => {
    // 6a. Path matches — update fileLastCheckedAt; retrocompat: persist fileHash if was null;
    //     recovery: reset FILE_MISSING back to IMPORTED if file returned to same path
    for (const match of reconciliation.matches) {
      if (match.reason === "path") {
        const existingHash = dbHashMap.get(match.recordingId);
        const needsHashUpdate = existingHash === null || existingHash === undefined;
        const needsStatusReset = dbStatusMap.get(match.recordingId) === "FILE_MISSING";
        tx.update(recordings)
          .set({
            fileLastCheckedAt: now,
            updatedAt: now,
            ...(needsHashUpdate ? { fileHash: match.fileHash } : {}),
            ...(needsStatusReset ? { status: "IMPORTED" } : {}),
          })
          .where(eq(recordings.id, match.recordingId))
          .run();
        if (needsHashUpdate || needsStatusReset) updatedCount++;
      }
    }

    // 6b. Hash matches (file was FILE_MISSING, now found at new path)
    for (const match of reconciliation.matches) {
      if (match.reason === "hash") {
        tx.update(recordings)
          .set({
            filePath: match.filePath,
            status: "IMPORTED",
            fileHash: match.fileHash,
            fileLastCheckedAt: now,
            updatedAt: now,
          })
          .where(eq(recordings.id, match.recordingId))
          .run();
        updatedCount++;
      }
    }

    // 6c. New files — insert as IMPORTED
    for (const file of reconciliation.newFiles) {
      const diskFile = diskFiles.find((f) => f.filePath === file.filePath);
      if (!diskFile) continue; // should not happen

      tx.insert(recordings)
        .values({
          id: randomUUID(),
          filePath: diskFile.filePath,
          originalFilename: diskFile.originalFilename,
          fileHash: diskFile.fileHash,
          fileLastCheckedAt: now,
          durationSeconds: diskFile.durationSeconds,
          sampleRate: diskFile.sampleRate,
          channels: diskFile.channels,
          format: diskFile.format,
          fileSizeBytes: diskFile.fileSizeBytes,
          status: "IMPORTED",
          createdAt: now,
          updatedAt: now,
        })
        .run();
      newCount++;
    }

    // 6d. Unmatched recordings — transition to FILE_MISSING
    if (reconciliation.unmatchedRecordingIds.length > 0) {
      const toMark = selectRecordingsToMarkMissing(
        reconciliation.unmatchedRecordingIds,
        missingTransitionCandidates,
        discoveredAudioPaths,
      );

      if (toMark.length > 0) {
        tx.update(recordings)
          .set({ status: "FILE_MISSING", updatedAt: now })
          .where(inArray(recordings.id, toMark))
          .run();
        missingCount += toMark.length;
      }
    }
  });

  return {
    newCount,
    updatedCount,
    missingCount,
    ambiguousCount: reconciliation.ambiguousMatches.length,
    failedCount: failedPaths.size,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getExtension(filename: string): string {
  const idx = filename.lastIndexOf(".");
  return idx >= 0 ? filename.slice(idx).toLowerCase() : "";
}

function getBasename(filePath: string): string {
  return filePath.slice(filePath.lastIndexOf("/") + 1);
}
