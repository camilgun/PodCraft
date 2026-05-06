import { describe, expect, it, vi, beforeEach } from "vitest";

type FetchInitWithDispatcher = RequestInit & { dispatcher?: unknown };

const { mockFetch, mockReadFile } = vi.hoisted(() => ({
  mockFetch: vi.fn<(url: string, init: FetchInitWithDispatcher) => Promise<Response>>(),
  mockReadFile: vi.fn<() => Promise<Buffer>>(),
}));

vi.mock("node:fs/promises", () => ({
  readFile: mockReadFile,
}));

vi.mock("../config.js", () => ({
  config: {
    mlServiceUrl: "http://ml.test",
  },
}));

vi.mock("undici", async (importOriginal) => {
  const actual = await importOriginal<typeof import("undici")>();
  return {
    ...actual,
    fetch: mockFetch,
  };
});

import { mlAlign, mlTranscribe } from "./ml-client.js";

type FormDataLike = {
  get(name: string): unknown;
};

function okJson(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("ml-client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadFile.mockResolvedValue(Buffer.from("audio"));
  });

  it("parses transcribe chunk metadata and sends it to align", async () => {
    mockFetch.mockResolvedValueOnce(
      okJson({
        text: "primo chunk secondo chunk",
        language: "it",
        inference_time_seconds: 10,
        audio_duration_seconds: 260,
        model_used: "asr",
        chunks: [
          { text: "primo chunk", start_time: 0, end_time: 240 },
          { text: "secondo chunk", start_time: 240, end_time: 260 },
        ],
      }),
    );

    const asrResult = await mlTranscribe("/tmp/audio.m4a", "it");

    expect(asrResult.ok).toBe(true);
    if (!asrResult.ok) throw new Error(asrResult.error);

    mockFetch.mockResolvedValueOnce(
      okJson({
        words: [{ word: "primo", start_time: 0.1, end_time: 0.4 }],
        inference_time_seconds: 1,
        model_used: "aligner",
      }),
    );

    const alignResult = await mlAlign(
      "/tmp/audio.m4a",
      asrResult.data.text,
      asrResult.data.language,
      asrResult.data.chunks,
    );

    expect(alignResult.ok).toBe(true);
    const alignFetch = mockFetch.mock.calls[1];
    expect(alignFetch?.[0]).toBe("http://ml.test/align");
    const form = alignFetch?.[1].body as FormDataLike;
    expect(form.get("text")).toBe("primo chunk secondo chunk");
    expect(form.get("language")).toBe("it");
    expect(form.get("chunks_json")).toBe(JSON.stringify(asrResult.data.chunks));
  });

  it("does not send chunks_json when align chunks are absent", async () => {
    mockFetch.mockResolvedValueOnce(
      okJson({
        words: [{ word: "ciao", start_time: 0.1, end_time: 0.4 }],
        inference_time_seconds: 1,
        model_used: "aligner",
      }),
    );

    const result = await mlAlign("/tmp/audio.m4a", "ciao", "it");

    expect(result.ok).toBe(true);
    const alignFetch = mockFetch.mock.calls[0];
    const form = alignFetch?.[1].body as FormDataLike;
    expect(form.get("chunks_json")).toBeNull();
  });
});
