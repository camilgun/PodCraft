import {
  recordingsListResponseSchema,
  recordingDetailResponseSchema,
  librarySyncResponseSchema,
  transcribeStartResponseSchema,
} from "@podcraft/shared";
import type { Recording, LibrarySyncResponse, TranscribeStartResponse } from "@podcraft/shared";

export type ApiError = {
  kind: "network" | "validation" | "server";
  message: string;
  status?: number;
};

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError };

async function apiFetch<T>(url: string, init?: RequestInit): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (err) {
    return {
      ok: false,
      error: { kind: "network", message: String(err) },
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      error: {
        kind: "server",
        message: `HTTP ${response.status}`,
        status: response.status,
      },
    };
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch (err) {
    return {
      ok: false,
      error: { kind: "validation", message: `Invalid JSON response: ${String(err)}` },
    };
  }

  return { ok: true, data: json as T };
}

export async function getRecordings(): Promise<ApiResult<Recording[]>> {
  const result = await apiFetch<unknown>("/api/recordings");
  if (!result.ok) return result;

  const parsed = recordingsListResponseSchema.safeParse(result.data);
  if (!parsed.success) {
    return {
      ok: false,
      error: { kind: "validation", message: parsed.error.message },
    };
  }
  // Cast is safe: Zod has validated the structure. The `as` is needed because
  // Zod's .nullish() infers `string | null | undefined` while the Recording
  // interface uses `?: string | null` (exactOptionalPropertyTypes mismatch).
  return { ok: true, data: parsed.data.recordings as Recording[] };
}

export async function getRecording(id: string): Promise<ApiResult<Recording>> {
  const result = await apiFetch<unknown>(`/api/recordings/${id}`);
  if (!result.ok) return result;

  const parsed = recordingDetailResponseSchema.safeParse(result.data);
  if (!parsed.success) {
    return {
      ok: false,
      error: { kind: "validation", message: parsed.error.message },
    };
  }
  return { ok: true, data: parsed.data.recording as Recording };
}

export async function triggerLibrarySync(): Promise<ApiResult<LibrarySyncResponse>> {
  const result = await apiFetch<unknown>("/api/library/sync", {
    method: "POST",
  });
  if (!result.ok) return result;

  const parsed = librarySyncResponseSchema.safeParse(result.data);
  if (!parsed.success) {
    return {
      ok: false,
      error: { kind: "validation", message: parsed.error.message },
    };
  }

  return { ok: true, data: parsed.data };
}

export async function triggerTranscribe(id: string): Promise<ApiResult<TranscribeStartResponse>> {
  const result = await apiFetch<unknown>(`/api/recordings/${id}/transcribe`, {
    method: "POST",
  });
  if (!result.ok) return result;

  const parsed = transcribeStartResponseSchema.safeParse(result.data);
  if (!parsed.success) {
    return {
      ok: false,
      error: { kind: "validation", message: parsed.error.message },
    };
  }

  return { ok: true, data: parsed.data };
}

/** Returns the audio stream URL for a recording. Used as the <audio> src. */
export function getAudioUrl(id: string): string {
  return `/api/files/${id}/audio`;
}
