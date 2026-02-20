import { describe, expect, it } from "vitest";
import { canTransition, VALID_TRANSITIONS } from "./index";
import type { RecordingStatus } from "./index";

describe("canTransition", () => {
  describe("valid transitions", () => {
    it("IMPORTED → TRANSCRIBING", () => {
      expect(canTransition("IMPORTED", "TRANSCRIBING")).toBe(true);
    });

    it("IMPORTED → ERROR", () => {
      expect(canTransition("IMPORTED", "ERROR")).toBe(true);
    });

    it("TRANSCRIBING → TRANSCRIBED", () => {
      expect(canTransition("TRANSCRIBING", "TRANSCRIBED")).toBe(true);
    });

    it("TRANSCRIBING → TRANSCRIBING (retry)", () => {
      expect(canTransition("TRANSCRIBING", "TRANSCRIBING")).toBe(true);
    });

    it("TRANSCRIBING → ERROR", () => {
      expect(canTransition("TRANSCRIBING", "ERROR")).toBe(true);
    });

    it("TRANSCRIBED → ANALYZING", () => {
      expect(canTransition("TRANSCRIBED", "ANALYZING")).toBe(true);
    });

    it("TRANSCRIBED → TRANSCRIBING (re-transcribe)", () => {
      expect(canTransition("TRANSCRIBED", "TRANSCRIBING")).toBe(true);
    });

    it("TRANSCRIBED → ERROR", () => {
      expect(canTransition("TRANSCRIBED", "ERROR")).toBe(true);
    });

    it("ANALYZING → REVIEWED", () => {
      expect(canTransition("ANALYZING", "REVIEWED")).toBe(true);
    });

    it("ANALYZING → ANALYZING (retry)", () => {
      expect(canTransition("ANALYZING", "ANALYZING")).toBe(true);
    });

    it("ANALYZED → ERROR", () => {
      expect(canTransition("ANALYZING", "ERROR")).toBe(true);
    });

    it("REVIEWED → EXPORTING", () => {
      expect(canTransition("REVIEWED", "EXPORTING")).toBe(true);
    });

    it("REVIEWED → ANALYZING (re-analyze)", () => {
      expect(canTransition("REVIEWED", "ANALYZING")).toBe(true);
    });

    it("REVIEWED → ERROR", () => {
      expect(canTransition("REVIEWED", "ERROR")).toBe(true);
    });

    it("EXPORTING → COMPLETED", () => {
      expect(canTransition("EXPORTING", "COMPLETED")).toBe(true);
    });

    it("EXPORTING → ERROR", () => {
      expect(canTransition("EXPORTING", "ERROR")).toBe(true);
    });

    it("COMPLETED → REVIEWED (back to review)", () => {
      expect(canTransition("COMPLETED", "REVIEWED")).toBe(true);
    });

    it("COMPLETED → ERROR", () => {
      expect(canTransition("COMPLETED", "ERROR")).toBe(true);
    });

    it("ERROR → TRANSCRIBING (retry transcription)", () => {
      expect(canTransition("ERROR", "TRANSCRIBING")).toBe(true);
    });

    it("ERROR → ANALYZING (retry analysis)", () => {
      expect(canTransition("ERROR", "ANALYZING")).toBe(true);
    });

    it("ERROR → EXPORTING (retry export)", () => {
      expect(canTransition("ERROR", "EXPORTING")).toBe(true);
    });
  });

  describe("invalid transitions", () => {
    it("IMPORTED → COMPLETED", () => {
      expect(canTransition("IMPORTED", "COMPLETED")).toBe(false);
    });

    it("IMPORTED → ANALYZING", () => {
      expect(canTransition("IMPORTED", "ANALYZING")).toBe(false);
    });

    it("IMPORTED → TRANSCRIBED", () => {
      expect(canTransition("IMPORTED", "TRANSCRIBED")).toBe(false);
    });

    it("TRANSCRIBING → IMPORTED", () => {
      expect(canTransition("TRANSCRIBING", "IMPORTED")).toBe(false);
    });

    it("TRANSCRIBING → COMPLETED", () => {
      expect(canTransition("TRANSCRIBING", "COMPLETED")).toBe(false);
    });

    it("TRANSCRIBED → COMPLETED", () => {
      expect(canTransition("TRANSCRIBED", "COMPLETED")).toBe(false);
    });

    it("TRANSCRIBED → IMPORTED", () => {
      expect(canTransition("TRANSCRIBED", "IMPORTED")).toBe(false);
    });

    it("ANALYZING → TRANSCRIBED", () => {
      expect(canTransition("ANALYZING", "TRANSCRIBED")).toBe(false);
    });

    it("ANALYZING → COMPLETED", () => {
      expect(canTransition("ANALYZING", "COMPLETED")).toBe(false);
    });

    it("REVIEWED → TRANSCRIBING", () => {
      expect(canTransition("REVIEWED", "TRANSCRIBING")).toBe(false);
    });

    it("REVIEWED → COMPLETED", () => {
      expect(canTransition("REVIEWED", "COMPLETED")).toBe(false);
    });

    it("EXPORTING → REVIEWING", () => {
      expect(canTransition("EXPORTING", "REVIEWED")).toBe(false);
    });

    it("EXPORTING → IMPORTED", () => {
      expect(canTransition("EXPORTING", "IMPORTED")).toBe(false);
    });

    it("COMPLETED → TRANSCRIBING", () => {
      expect(canTransition("COMPLETED", "TRANSCRIBING")).toBe(false);
    });

    it("COMPLETED → IMPORTED", () => {
      expect(canTransition("COMPLETED", "IMPORTED")).toBe(false);
    });

    it("ERROR → ERROR", () => {
      expect(canTransition("ERROR", "ERROR")).toBe(false);
    });

    it("ERROR → COMPLETED", () => {
      expect(canTransition("ERROR", "COMPLETED")).toBe(false);
    });

    it("ERROR → IMPORTED", () => {
      expect(canTransition("ERROR", "IMPORTED")).toBe(false);
    });
  });

  describe("FILE_MISSING transitions", () => {
    it("any processing state → FILE_MISSING", () => {
      const processable: RecordingStatus[] = [
        "IMPORTED",
        "TRANSCRIBING",
        "TRANSCRIBED",
        "ANALYZING",
        "REVIEWED",
        "EXPORTING",
        "COMPLETED",
        "ERROR",
      ];
      for (const status of processable) {
        expect(canTransition(status, "FILE_MISSING")).toBe(true);
      }
    });

    it("FILE_MISSING → IMPORTED (file found again)", () => {
      expect(canTransition("FILE_MISSING", "IMPORTED")).toBe(true);
    });

    it("FILE_MISSING → TRANSCRIBING is invalid", () => {
      expect(canTransition("FILE_MISSING", "TRANSCRIBING")).toBe(false);
    });

    it("FILE_MISSING → ERROR is invalid", () => {
      expect(canTransition("FILE_MISSING", "ERROR")).toBe(false);
    });

    it("FILE_MISSING → FILE_MISSING is invalid", () => {
      expect(canTransition("FILE_MISSING", "FILE_MISSING")).toBe(false);
    });
  });

  describe("VALID_TRANSITIONS completeness", () => {
    const allStatuses: RecordingStatus[] = [
      "IMPORTED",
      "TRANSCRIBING",
      "TRANSCRIBED",
      "ANALYZING",
      "REVIEWED",
      "EXPORTING",
      "COMPLETED",
      "ERROR",
      "FILE_MISSING",
    ];

    it("covers every RecordingStatus as a key", () => {
      for (const status of allStatuses) {
        expect(VALID_TRANSITIONS).toHaveProperty(status);
      }
    });

    it("has only valid RecordingStatus values in each transition array", () => {
      for (const [, targets] of Object.entries(VALID_TRANSITIONS)) {
        for (const target of targets) {
          expect(allStatuses).toContain(target);
        }
      }
    });
  });
});
