import { execFile } from "node:child_process";
import { extname } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { SUPPORTED_AUDIO_FORMATS } from "@podcraft/shared";

const execFileAsync = promisify(execFile);

// ─── Internal ffprobe output schema ───────────────────────────────────────────

const ffprobeStreamSchema = z.object({
  codec_type: z.string(),
  sample_rate: z.string().optional(),
  channels: z.number().optional(),
});

const ffprobeFormatSchema = z.object({
  duration: z.string(),
  size: z.string(),
});

const ffprobeOutputSchema = z.object({
  streams: z.array(ffprobeStreamSchema),
  format: ffprobeFormatSchema,
});

// ─── Public interface ──────────────────────────────────────────────────────────

export interface AudioMetadata {
  durationSeconds: number;
  sampleRate: number;
  channels: number;
  format: "wav" | "mp3" | "m4a" | "flac" | "ogg";
  fileSizeBytes: number;
}

/**
 * Probes an audio file with ffprobe and returns parsed metadata.
 * Throws if ffprobe is not available, the file is unreadable, or the output
 * cannot be parsed into valid AudioMetadata.
 */
export async function probeAudioFile(filePath: string): Promise<AudioMetadata> {
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync("ffprobe", [
      "-v",
      "quiet",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      filePath,
    ]));
  } catch (cause) {
    throw new Error(`ffprobe failed for "${filePath}": ${String(cause)}`);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(stdout);
  } catch {
    throw new Error(`ffprobe returned non-JSON output for "${filePath}"`);
  }

  const parsed = ffprobeOutputSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `ffprobe output has unexpected shape for "${filePath}": ${parsed.error.message}`,
    );
  }

  const { streams, format } = parsed.data;

  const audioStream = streams.find((s) => s.codec_type === "audio");
  if (!audioStream) {
    throw new Error(`No audio stream found in "${filePath}"`);
  }

  const durationSeconds = parseFloat(format.duration);
  if (!isFinite(durationSeconds) || durationSeconds < 0) {
    throw new Error(`Invalid duration "${format.duration}" in "${filePath}"`);
  }

  const sampleRate = parseInt(audioStream.sample_rate ?? "0", 10);
  if (!sampleRate || sampleRate <= 0) {
    throw new Error(`Invalid sample_rate "${audioStream.sample_rate}" in "${filePath}"`);
  }

  const channels = audioStream.channels;
  if (!channels || channels <= 0) {
    throw new Error(`Invalid channels "${channels}" in "${filePath}"`);
  }

  const fileSizeBytes = parseInt(format.size, 10);
  if (!isFinite(fileSizeBytes) || fileSizeBytes < 0) {
    throw new Error(`Invalid size "${format.size}" in "${filePath}"`);
  }

  // Derive format from file extension — more reliable than ffprobe format_name
  const ext = extname(filePath).toLowerCase().slice(1);
  const supportedFormats: readonly string[] = SUPPORTED_AUDIO_FORMATS;
  if (!supportedFormats.includes(ext)) {
    throw new Error(
      `Unsupported audio format extension ".${ext}" for "${filePath}". Supported: ${SUPPORTED_AUDIO_FORMATS.join(", ")}`,
    );
  }

  return {
    durationSeconds,
    sampleRate,
    channels,
    format: ext as "wav" | "mp3" | "m4a" | "flac" | "ogg",
    fileSizeBytes,
  };
}
