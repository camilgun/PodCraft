import { readFile } from "node:fs/promises";
import { Agent, fetch as undiciFetch, FormData as UndiciFormData } from "undici";
import { transcribeResponseSchema, alignResponseSchema } from "@podcraft/shared";
import type { TranscribeChunk, TranscribeResponse, AlignResponse } from "@podcraft/shared";
import { config } from "../config.js";

export type MlResult<T> = { ok: true; data: T } | { ok: false; error: string };

// Long inference can take tens of minutes for hour-long audio files.
// headersTimeout and bodyTimeout in undici default to 300s — too short for large files.
const ML_REQUEST_TIMEOUT_MS = 90 * 60 * 1000; // 90 minutes

const mlAgent = new Agent({
  connectTimeout: 30_000,
  headersTimeout: ML_REQUEST_TIMEOUT_MS,
  bodyTimeout: ML_REQUEST_TIMEOUT_MS,
});

async function buildAudioFormData(
  filePath: string,
  fields: Record<string, string>,
): Promise<UndiciFormData> {
  const buf = await readFile(filePath);
  const filename = filePath.split("/").pop() ?? "audio";

  const form = new UndiciFormData();
  form.append("file", new File([buf], filename));
  for (const [key, value] of Object.entries(fields)) {
    form.append(key, value);
  }
  return form;
}

export async function mlTranscribe(
  filePath: string,
  language?: string,
): Promise<MlResult<TranscribeResponse>> {
  let response: Response;
  try {
    const fields: Record<string, string> = {};
    if (language) fields["language"] = language;
    const form = await buildAudioFormData(filePath, fields);
    response = (await undiciFetch(`${config.mlServiceUrl}/transcribe`, {
      method: "POST",
      body: form,
      dispatcher: mlAgent,
    })) as Response;
  } catch (err) {
    return { ok: false, error: `Network error calling /transcribe: ${String(err)}` };
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    return { ok: false, error: `ML /transcribe returned HTTP ${response.status}: ${text}` };
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch (err) {
    return { ok: false, error: `Invalid JSON from /transcribe: ${String(err)}` };
  }

  const parsed = transcribeResponseSchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, error: `Validation error from /transcribe: ${parsed.error.message}` };
  }

  return { ok: true, data: parsed.data };
}

export async function mlAlign(
  filePath: string,
  text: string,
  language?: string,
  chunks?: TranscribeChunk[] | null,
): Promise<MlResult<AlignResponse>> {
  let response: Response;
  try {
    const fields: Record<string, string> = { text };
    if (language) fields["language"] = language;
    if (chunks && chunks.length > 0) fields["chunks_json"] = JSON.stringify(chunks);
    const form = await buildAudioFormData(filePath, fields);
    response = (await undiciFetch(`${config.mlServiceUrl}/align`, {
      method: "POST",
      body: form,
      dispatcher: mlAgent,
    })) as Response;
  } catch (err) {
    return { ok: false, error: `Network error calling /align: ${String(err)}` };
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    return { ok: false, error: `ML /align returned HTTP ${response.status}: ${text}` };
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch (err) {
    return { ok: false, error: `Invalid JSON from /align: ${String(err)}` };
  }

  const parsed = alignResponseSchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, error: `Validation error from /align: ${parsed.error.message}` };
  }

  return { ok: true, data: parsed.data };
}
