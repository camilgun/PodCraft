import { describe, it, expect } from "vitest";
import { formatDuration, formatDate, formatFileSize } from "./format";

describe("formatDuration", () => {
  it("formats seconds under a minute", () => {
    expect(formatDuration(45)).toBe("0:45");
  });
  it("pads single-digit seconds", () => {
    expect(formatDuration(61)).toBe("1:01");
  });
  it("formats minutes and seconds", () => {
    expect(formatDuration(125)).toBe("2:05");
  });
  it("formats hours with zero-padded minutes and seconds", () => {
    expect(formatDuration(3661)).toBe("1:01:01");
  });
  it("formats exactly one hour", () => {
    expect(formatDuration(3600)).toBe("1:00:00");
  });
  it("formats zero seconds", () => {
    expect(formatDuration(0)).toBe("0:00");
  });
});

describe("formatDate", () => {
  it("formats ISO datetime strings using the local short date format", () => {
    const iso = "2026-02-10T12:34:56.000Z";
    const expected = new Intl.DateTimeFormat(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(new Date(iso));

    expect(formatDate(iso)).toBe(expected);
  });

  it("supports ISO strings with timezone offsets", () => {
    const iso = "2026-02-10T23:45:00+02:00";
    const expected = new Intl.DateTimeFormat(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(new Date(iso));

    expect(formatDate(iso)).toBe(expected);
  });
});

describe("formatFileSize", () => {
  it("formats bytes below 1 KB", () => {
    expect(formatFileSize(500)).toBe("500 B");
  });
  it("formats kilobytes", () => {
    expect(formatFileSize(2048)).toBe("2.0 KB");
  });
  it("formats megabytes", () => {
    expect(formatFileSize(5 * 1024 * 1024)).toBe("5.0 MB");
  });
  it("formats exactly 1 KB", () => {
    expect(formatFileSize(1024)).toBe("1.0 KB");
  });
  it("formats gigabytes", () => {
    expect(formatFileSize(1.5 * 1024 * 1024 * 1024)).toBe("1.50 GB");
  });
  it("formats exactly 1 GB", () => {
    expect(formatFileSize(1024 * 1024 * 1024)).toBe("1.00 GB");
  });
});
