import { createHash } from "node:crypto";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FILE_HASH_WINDOW_BYTES } from "@podcraft/shared";
import { computeFileHash } from "./file-hash.js";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "file-hash-test-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

/** Computes the expected hash for given content bytes + declared size */
function expectedHash(contentBytes: Buffer, fileSizeBytes: number): string {
  const hash = createHash("sha256");
  hash.update(contentBytes);
  const sizeBuffer = Buffer.allocUnsafe(8);
  sizeBuffer.writeBigUInt64LE(BigInt(fileSizeBytes));
  hash.update(sizeBuffer);
  return hash.digest("hex");
}

describe("computeFileHash", () => {
  it("produces a 64-character lowercase hex string", async () => {
    const filePath = join(tempDir, "sample.wav");
    const content = Buffer.from("hello world");
    await writeFile(filePath, content);

    const result = await computeFileHash(filePath, content.length);

    expect(result).toMatch(/^[a-f0-9]{64}$/);
  });

  it("is deterministic — same file yields same hash", async () => {
    const filePath = join(tempDir, "deterministic.wav");
    const content = Buffer.from("podcast audio data");
    await writeFile(filePath, content);

    const hash1 = await computeFileHash(filePath, content.length);
    const hash2 = await computeFileHash(filePath, content.length);

    expect(hash1).toBe(hash2);
  });

  it("matches manually computed SHA-256(content || size_le64)", async () => {
    const filePath = join(tempDir, "known.wav");
    const content = Buffer.from("known content");
    await writeFile(filePath, content);

    const result = await computeFileHash(filePath, content.length);

    expect(result).toBe(expectedHash(content, content.length));
  });

  it("files differing by one byte produce different hashes", async () => {
    const contentA = Buffer.from("abcdef");
    const contentB = Buffer.from("abcdeg");
    const fileA = join(tempDir, "a.wav");
    const fileB = join(tempDir, "b.wav");
    await writeFile(fileA, contentA);
    await writeFile(fileB, contentB);

    const hashA = await computeFileHash(fileA, contentA.length);
    const hashB = await computeFileHash(fileB, contentB.length);

    expect(hashA).not.toBe(hashB);
  });

  it("same content bytes but different fileSizeBytes argument yields different hash", async () => {
    const filePath = join(tempDir, "same-content.wav");
    const content = Buffer.from("audio content");
    await writeFile(filePath, content);

    const hash1 = await computeFileHash(filePath, content.length);
    const hash2 = await computeFileHash(filePath, content.length + 1);

    expect(hash1).not.toBe(hash2);
  });

  it("only reads up to FILE_HASH_WINDOW_BYTES — large file hash matches first-window hash", async () => {
    // Create a file larger than FILE_HASH_WINDOW_BYTES
    const windowContent = Buffer.alloc(FILE_HASH_WINDOW_BYTES, 0x42); // 1MB of 0x42
    const extra = Buffer.alloc(512, 0xff); // 512 bytes of 0xff after the window
    const largeContent = Buffer.concat([windowContent, extra]);
    const filePath = join(tempDir, "large.wav");
    await writeFile(filePath, largeContent);

    const actualHash = await computeFileHash(filePath, largeContent.length);

    // Expected: hash of exactly first FILE_HASH_WINDOW_BYTES + declared size
    const expected = expectedHash(windowContent, largeContent.length);
    expect(actualHash).toBe(expected);
  });

  it("file smaller than FILE_HASH_WINDOW_BYTES uses all bytes", async () => {
    const content = Buffer.from("tiny file");
    const filePath = join(tempDir, "tiny.wav");
    await writeFile(filePath, content);

    const actualHash = await computeFileHash(filePath, content.length);

    expect(actualHash).toBe(expectedHash(content, content.length));
  });
});
