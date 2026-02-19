import { describe, expect, it } from "vitest";
import { parseSingleByteRange } from "./http-range.js";

describe("parseSingleByteRange", () => {
  it("parses explicit start-end range", () => {
    expect(parseSingleByteRange("bytes=100-200", 1000)).toEqual({ start: 100, end: 200 });
  });

  it("parses open-ended range", () => {
    expect(parseSingleByteRange("bytes=500-", 1000)).toEqual({ start: 500, end: 999 });
  });

  it("parses suffix range (last N bytes)", () => {
    expect(parseSingleByteRange("bytes=-500", 1000)).toEqual({ start: 500, end: 999 });
  });

  it("clamps suffix range bigger than file size to full file", () => {
    expect(parseSingleByteRange("bytes=-999999", 1000)).toEqual({ start: 0, end: 999 });
  });

  it("clamps end beyond EOF", () => {
    expect(parseSingleByteRange("bytes=700-5000", 1000)).toEqual({ start: 700, end: 999 });
  });

  it("rejects invalid unit", () => {
    expect(parseSingleByteRange("items=0-99", 1000)).toBeNull();
  });

  it("rejects malformed range", () => {
    expect(parseSingleByteRange("bytes=abc-def", 1000)).toBeNull();
  });

  it("rejects start > end", () => {
    expect(parseSingleByteRange("bytes=200-100", 1000)).toBeNull();
  });

  it("rejects start at or beyond file size", () => {
    expect(parseSingleByteRange("bytes=1000-1001", 1000)).toBeNull();
  });

  it("rejects zero-length suffix range", () => {
    expect(parseSingleByteRange("bytes=-0", 1000)).toBeNull();
  });

  it("rejects empty range values", () => {
    expect(parseSingleByteRange("bytes=-", 1000)).toBeNull();
  });

  it("rejects unsupported multi-range requests", () => {
    expect(parseSingleByteRange("bytes=0-99,200-299", 1000)).toBeNull();
  });
});
