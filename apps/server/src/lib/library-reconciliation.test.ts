import { describe, expect, it } from "vitest";
import { reconcileLibraryFiles, type LibraryDiskFile, type LibraryRecordingIdentity } from "./library-reconciliation.js";

const hashA = "a".repeat(64);
const hashB = "b".repeat(64);

describe("reconcileLibraryFiles", () => {
  it("matches by path before hash", () => {
    const recordings: LibraryRecordingIdentity[] = [
      {
        id: "rec-by-path",
        filePath: "/audio/current.wav",
        fileHash: hashA,
        status: "IMPORTED"
      },
      {
        id: "rec-missing-same-hash",
        filePath: "/audio/old.wav",
        fileHash: hashA,
        status: "FILE_MISSING"
      }
    ];

    const files: LibraryDiskFile[] = [{ filePath: "/audio/current.wav", fileHash: hashA }];

    const result = reconcileLibraryFiles(files, recordings);
    expect(result.matches).toEqual([
      {
        recordingId: "rec-by-path",
        filePath: "/audio/current.wav",
        fileHash: hashA,
        reason: "path"
      }
    ]);
    expect(result.newFiles).toEqual([]);
    expect(result.ambiguousMatches).toEqual([]);
  });

  it("matches by hash only for FILE_MISSING rows", () => {
    const recordings: LibraryRecordingIdentity[] = [
      {
        id: "rec-missing",
        filePath: "/audio/old-path.wav",
        fileHash: hashA,
        status: "FILE_MISSING"
      }
    ];

    const files: LibraryDiskFile[] = [{ filePath: "/audio/new-path.wav", fileHash: hashA }];
    const result = reconcileLibraryFiles(files, recordings);

    expect(result.matches).toEqual([
      {
        recordingId: "rec-missing",
        filePath: "/audio/new-path.wav",
        fileHash: hashA,
        reason: "hash"
      }
    ]);
    expect(result.newFiles).toEqual([]);
    expect(result.ambiguousMatches).toEqual([]);
  });

  it("does not hash-match non-FILE_MISSING rows", () => {
    const recordings: LibraryRecordingIdentity[] = [
      {
        id: "rec-ready",
        filePath: "/audio/existing.wav",
        fileHash: hashA,
        status: "TRANSCRIBED"
      }
    ];

    const files: LibraryDiskFile[] = [{ filePath: "/audio/new.wav", fileHash: hashA }];
    const result = reconcileLibraryFiles(files, recordings);

    expect(result.matches).toEqual([]);
    expect(result.newFiles).toEqual([{ filePath: "/audio/new.wav", fileHash: hashA }]);
    expect(result.ambiguousMatches).toEqual([]);
  });

  it("reports ambiguous hash matches and avoids auto-linking", () => {
    const recordings: LibraryRecordingIdentity[] = [
      {
        id: "missing-a",
        filePath: "/audio/missing-a.wav",
        fileHash: hashA,
        status: "FILE_MISSING"
      },
      {
        id: "missing-b",
        filePath: "/audio/missing-b.wav",
        fileHash: hashA,
        status: "FILE_MISSING"
      }
    ];

    const files: LibraryDiskFile[] = [{ filePath: "/audio/found.wav", fileHash: hashA }];
    const result = reconcileLibraryFiles(files, recordings);

    expect(result.matches).toEqual([]);
    expect(result.newFiles).toEqual([]);
    expect(result.ambiguousMatches).toEqual([
      {
        reason: "hash",
        filePath: "/audio/found.wav",
        fileHash: hashA,
        candidateRecordingIds: ["missing-a", "missing-b"]
      }
    ]);
  });

  it("reports unmatched recording IDs after reconciliation", () => {
    const recordings: LibraryRecordingIdentity[] = [
      {
        id: "matched-by-path",
        filePath: "/audio/path.wav",
        fileHash: hashA,
        status: "IMPORTED"
      },
      {
        id: "left-unmatched",
        filePath: "/audio/other.wav",
        fileHash: hashB,
        status: "TRANSCRIBED"
      }
    ];

    const files: LibraryDiskFile[] = [{ filePath: "/audio/path.wav", fileHash: hashA }];
    const result = reconcileLibraryFiles(files, recordings);

    expect(result.matches).toHaveLength(1);
    expect(result.unmatchedRecordingIds).toEqual(["left-unmatched"]);
  });
});
