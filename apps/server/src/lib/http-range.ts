export interface ByteRange {
  start: number;
  end: number;
}

/**
 * Parses a single HTTP byte-range header value (e.g. "bytes=500-999", "bytes=500-", "bytes=-500").
 * Returns null for invalid/unsupported ranges (including multi-range requests).
 */
export function parseSingleByteRange(rangeHeader: string, fileSize: number): ByteRange | null {
  if (!Number.isInteger(fileSize) || fileSize <= 0) {
    return null;
  }

  const unitMatch = /^bytes=(.+)$/i.exec(rangeHeader.trim());
  if (!unitMatch) {
    return null;
  }

  const spec = unitMatch[1]?.trim();
  if (!spec || spec.includes(",")) {
    return null;
  }

  const rangeMatch = /^(\d*)-(\d*)$/.exec(spec);
  if (!rangeMatch) {
    return null;
  }

  const startStr = rangeMatch[1] ?? "";
  const endStr = rangeMatch[2] ?? "";

  if (!startStr && !endStr) {
    return null;
  }

  // Suffix range: "bytes=-N" => last N bytes.
  if (!startStr) {
    const suffixLength = Number.parseInt(endStr, 10);
    if (!Number.isInteger(suffixLength) || suffixLength <= 0) {
      return null;
    }

    const start = Math.max(fileSize - suffixLength, 0);
    return { start, end: fileSize - 1 };
  }

  const start = Number.parseInt(startStr, 10);
  if (!Number.isInteger(start) || start < 0 || start >= fileSize) {
    return null;
  }

  // Open-ended range: "bytes=N-" => from N to EOF.
  if (!endStr) {
    return { start, end: fileSize - 1 };
  }

  const requestedEnd = Number.parseInt(endStr, 10);
  if (!Number.isInteger(requestedEnd) || requestedEnd < 0 || requestedEnd < start) {
    return null;
  }

  // Per RFC 7233, end positions beyond EOF are clamped.
  const end = Math.min(requestedEnd, fileSize - 1);
  return { start, end };
}
