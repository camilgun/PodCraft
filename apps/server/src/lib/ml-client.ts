import { readFile } from "node:fs/promises";
import {
  transcribeResponseSchema,
  alignResponseSchema,
} from "@podcraft/shared";
import type { TranscribeResponse, AlignResponse } from "@podcraft/shared";
import { config } from "../config.js";

export type MlResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function buildAudioFormData(
  filePath: string,
  fields: Record<string, string>,
): Promise<FormData> {
  const buf = await readFile(filePath);
  const blob = new Blob([buf]);
  const filename = filePath.split("/").pop() ?? "audio";

  const form = new FormData();
  form.append("file", blob, filename);
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
    response = await fetch(`${config.mlServiceUrl}/transcribe`, {
      method: "POST",
      body: form,
    });
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
): Promise<MlResult<AlignResponse>> {
  let response: Response;
  try {
    const fields: Record<string, string> = { text };
    if (language) fields["language"] = language;
    const form = await buildAudioFormData(filePath, fields);
    response = await fetch(`${config.mlServiceUrl}/align`, {
      method: "POST",
      body: form,
    });
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
