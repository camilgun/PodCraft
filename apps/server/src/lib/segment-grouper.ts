import { randomUUID } from "node:crypto";
import type { AlignedSegment, AlignedWord, MlAlignedWord } from "@podcraft/shared";

export interface GroupWordsOptions {
  gapThresholdSeconds?: number;
  maxWords?: number;
  minWords?: number;
}

/**
 * Groups a flat list of ML-aligned words into AlignedSegment objects.
 * Segments break on long inter-word pauses or when maxWords is reached.
 *
 * Pure function — no I/O, fully unit-testable.
 *
 * Note: Qwen3-ForcedAligner does not emit per-word confidence scores.
 * All AlignedWord.confidence values are set to 1.0 as a neutral default.
 */
export function groupWordsIntoSegments(
  words: MlAlignedWord[],
  opts: GroupWordsOptions = {},
): AlignedSegment[] {
  const gapThreshold = opts.gapThresholdSeconds ?? 1.0;
  const maxWords = opts.maxWords ?? 15;
  const minWords = opts.minWords ?? 3;

  if (words.length === 0) return [];

  const segments: AlignedSegment[] = [];
  let current: MlAlignedWord[] = [];
  let orderIndex = 0;

  function flush() {
    if (current.length === 0) return;

    const alignedWords: AlignedWord[] = current.map((w) => ({
      word: w.word,
      startTime: w.start_time,
      endTime: w.end_time,
      confidence: 1.0,
    }));

    const first = current[0]!;
    const last = current[current.length - 1]!;

    segments.push({
      id: randomUUID(),
      text: current.map((w) => w.word).join(" "),
      startTime: first.start_time,
      endTime: last.end_time,
      orderIndex,
      words: alignedWords,
    });

    orderIndex++;
    current = [];
  }

  for (let i = 0; i < words.length; i++) {
    const word = words[i]!;
    current.push(word);

    const isLast = i === words.length - 1;
    const nextWord = words[i + 1];
    const gap = nextWord !== undefined ? nextWord.start_time - word.end_time : 0;
    const hasLongGap = gap >= gapThreshold;
    const isTooLong = current.length >= maxWords;

    if (isLast || isTooLong || (hasLongGap && current.length >= minWords)) {
      flush();
    }
  }

  return segments;
}
