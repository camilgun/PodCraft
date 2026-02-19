import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import { FILE_HASH_WINDOW_BYTES } from "@podcraft/shared";

/**
 * Computes a fast, practically-unique file fingerprint:
 * SHA-256(first FILE_HASH_WINDOW_BYTES of file || fileSizeBytes as 8-byte little-endian uint64)
 *
 * Using first 1MB + total size catches both content differences and truncations/extensions
 * without reading the entire file.
 */
export async function computeFileHash(filePath: string, fileSizeBytes: number): Promise<string> {
  const hash = createHash("sha256");

  const fileHandle = await open(filePath, "r");
  try {
    const windowBuffer = Buffer.allocUnsafe(FILE_HASH_WINDOW_BYTES);
    const { bytesRead } = await fileHandle.read(windowBuffer, 0, FILE_HASH_WINDOW_BYTES, 0);
    hash.update(windowBuffer.subarray(0, bytesRead));
  } finally {
    await fileHandle.close();
  }

  const sizeBuffer = Buffer.allocUnsafe(8);
  sizeBuffer.writeBigUInt64LE(BigInt(fileSizeBytes));
  hash.update(sizeBuffer);

  return hash.digest("hex");
}
