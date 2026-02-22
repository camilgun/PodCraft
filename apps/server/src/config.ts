import os from "node:os";

function resolveRecordingsDir(): string {
  const raw = process.env["RECORDINGS_DIR"];
  if (!raw) {
    throw new Error(
      "RECORDINGS_DIR env var is required. Set it in .env (e.g. RECORDINGS_DIR=~/registrazioni)",
    );
  }
  return raw.startsWith("~") ? raw.replace("~", os.homedir()) : raw;
}

export const config = {
  recordingsDir: resolveRecordingsDir(),
  databaseUrl: process.env["DATABASE_URL"] ?? "podcraft.db",
  port: parseInt(process.env["PORT"] ?? "4000", 10),
  mlServiceUrl: process.env["ML_SERVICE_URL"] ?? "http://127.0.0.1:5001",
  redisUrl: process.env["REDIS_URL"] ?? "redis://127.0.0.1:6379",
} as const;
