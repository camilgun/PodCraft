import { describe, expect, it } from "vitest";
import {
  selectRecordingsToMarkMissing,
  shouldAbortSyncForProbeFailures,
  type MissingTransitionCandidate,
} from "./library-sync-decisions.js";

describe("selectRecordingsToMarkMissing", () => {
  it("marks unmatched recordings as FILE_MISSING when file path was not discovered", () => {
    const candidates: MissingTransitionCandidate[] = [
      { id: "rec-1", filePath: "/audio/one.wav", status: "TRANSCRIBED" },
      { id: "rec-2", filePath: "/audio/two.wav", status: "IMPORTED" },
    ];

    const result = selectRecordingsToMarkMissing(
      ["rec-1", "rec-2"],
      candidates,
      new Set<string>(["/audio/two.wav"]),
    );

    expect(result).toEqual(["rec-1"]);
  });

  it("does not mark recordings whose file path was discovered but probe/hash failed", () => {
    const candidates: MissingTransitionCandidate[] = [
      { id: "rec-1", filePath: "/audio/present.wav", status: "TRANSCRIBED" },
    ];

    const result = selectRecordingsToMarkMissing(
      ["rec-1"],
      candidates,
      new Set<string>(["/audio/present.wav"]),
    );

    expect(result).toEqual([]);
  });

  it("respects state machine and does not re-mark FILE_MISSING rows", () => {
    const candidates: MissingTransitionCandidate[] = [
      { id: "rec-missing", filePath: "/audio/missing.wav", status: "FILE_MISSING" },
    ];

    const result = selectRecordingsToMarkMissing(["rec-missing"], candidates, new Set<string>());

    expect(result).toEqual([]);
  });
});

describe("shouldAbortSyncForProbeFailures", () => {
  it("returns true when every discovered audio file failed probe/hash", () => {
    expect(
      shouldAbortSyncForProbeFailures({
        discoveredAudioFileCount: 3,
        successfulProbeCount: 0,
        failedProbeCount: 3,
      }),
    ).toBe(true);
  });

  it("returns false when at least one file was processed successfully", () => {
    expect(
      shouldAbortSyncForProbeFailures({
        discoveredAudioFileCount: 3,
        successfulProbeCount: 1,
        failedProbeCount: 2,
      }),
    ).toBe(false);
  });

  it("returns false when no audio files were discovered", () => {
    expect(
      shouldAbortSyncForProbeFailures({
        discoveredAudioFileCount: 0,
        successfulProbeCount: 0,
        failedProbeCount: 0,
      }),
    ).toBe(false);
  });
});
