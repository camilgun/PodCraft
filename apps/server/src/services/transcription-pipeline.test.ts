import { describe, it, expect } from "vitest";
import { groupWordsIntoSegments } from "../lib/segment-grouper.js";
import type { MlAlignedWord } from "@podcraft/shared";

function word(w: string, start: number, end: number): MlAlignedWord {
  return { word: w, start_time: start, end_time: end };
}

describe("groupWordsIntoSegments", () => {
  it("returns [] for empty input", () => {
    expect(groupWordsIntoSegments([])).toEqual([]);
  });

  it("returns one segment for a single word", () => {
    const result = groupWordsIntoSegments([word("ciao", 0.0, 0.5)]);
    expect(result).toHaveLength(1);
    expect(result[0]!.text).toBe("ciao");
    expect(result[0]!.startTime).toBe(0.0);
    expect(result[0]!.endTime).toBe(0.5);
    expect(result[0]!.orderIndex).toBe(0);
  });

  it("keeps words in the same segment when gap < threshold", () => {
    const words = [word("uno", 0.0, 0.5), word("due", 0.6, 1.0)]; // gap = 0.1
    const result = groupWordsIntoSegments(words, { gapThresholdSeconds: 1.0 });
    expect(result).toHaveLength(1);
    expect(result[0]!.text).toBe("uno due");
  });

  it("splits on gap >= threshold when current.length >= minWords", () => {
    const words = [
      word("a", 0.0, 0.3),
      word("b", 0.4, 0.6),
      word("c", 0.7, 1.0),
      // gap of 2.0s before next word
      word("d", 3.0, 3.3),
      word("e", 3.4, 3.6),
      word("f", 3.7, 4.0),
    ];
    const result = groupWordsIntoSegments(words, {
      gapThresholdSeconds: 1.0,
      minWords: 3,
    });
    expect(result).toHaveLength(2);
    expect(result[0]!.text).toBe("a b c");
    expect(result[1]!.text).toBe("d e f");
  });

  it("does NOT split on gap when current.length < minWords", () => {
    const words = [
      word("a", 0.0, 0.3),
      word("b", 0.4, 0.6),
      // gap of 2.0s but only 2 words accumulated (minWords = 3)
      word("c", 2.7, 3.0),
      word("d", 3.1, 3.4),
      word("e", 3.5, 3.8),
    ];
    const result = groupWordsIntoSegments(words, {
      gapThresholdSeconds: 1.0,
      minWords: 3,
    });
    // No split because we never had >= 3 words before the gap
    expect(result).toHaveLength(1);
    expect(result[0]!.text).toBe("a b c d e");
  });

  it("forces a split at maxWords even without a gap", () => {
    const words = Array.from({ length: 6 }, (_, i) =>
      word(`w${String(i)}`, i * 0.5, i * 0.5 + 0.4),
    );
    const result = groupWordsIntoSegments(words, { maxWords: 3, minWords: 1 });
    expect(result).toHaveLength(2);
    expect(result[0]!.words).toHaveLength(3);
    expect(result[1]!.words).toHaveLength(3);
  });

  it("sets orderIndex incrementally from 0", () => {
    const words = [
      word("a", 0.0, 0.3),
      word("b", 0.4, 0.6),
      word("c", 0.7, 1.0),
      word("d", 3.0, 3.3),
      word("e", 3.4, 3.6),
      word("f", 3.7, 4.0),
    ];
    const result = groupWordsIntoSegments(words, { gapThresholdSeconds: 1.0, minWords: 3 });
    expect(result[0]!.orderIndex).toBe(0);
    expect(result[1]!.orderIndex).toBe(1);
  });

  it("sets startTime from first word and endTime from last word of each segment", () => {
    const words = [word("primo", 1.0, 1.5), word("secondo", 2.0, 2.8)];
    const result = groupWordsIntoSegments(words);
    expect(result[0]!.startTime).toBe(1.0);
    expect(result[0]!.endTime).toBe(2.8);
  });

  it("sets confidence = 1.0 on every AlignedWord", () => {
    const words = [word("parola", 0.0, 0.5), word("altra", 0.6, 1.0)];
    const result = groupWordsIntoSegments(words);
    for (const seg of result) {
      for (const w of seg.words) {
        expect(w.confidence).toBe(1.0);
      }
    }
  });

  it("joins word.word with spaces for segment text", () => {
    const words = [word("ciao", 0.0, 0.3), word("mondo", 0.4, 0.8)];
    const result = groupWordsIntoSegments(words);
    expect(result[0]!.text).toBe("ciao mondo");
  });

  it("assigns unique ids to each segment", () => {
    const words = [
      word("a", 0.0, 0.3),
      word("b", 0.4, 0.6),
      word("c", 0.7, 1.0),
      word("d", 3.0, 3.3),
      word("e", 3.4, 3.6),
      word("f", 3.7, 4.0),
    ];
    const result = groupWordsIntoSegments(words, { gapThresholdSeconds: 1.0, minWords: 3 });
    const ids = result.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    // UUID v4 format
    for (const id of ids) {
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    }
  });

  it("maps MlAlignedWord snake_case to AlignedWord camelCase", () => {
    const words = [word("test", 1.2, 1.8)];
    const result = groupWordsIntoSegments(words);
    const w = result[0]!.words[0]!;
    expect(w.word).toBe("test");
    expect(w.startTime).toBe(1.2);
    expect(w.endTime).toBe(1.8);
  });
});
