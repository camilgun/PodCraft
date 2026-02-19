import { fileURLToPath } from "node:url";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema.js";

const dbPath = process.env["DATABASE_URL"] ?? "podcraft.db";
const sqlite = new Database(dbPath);

// Enable WAL mode for better concurrent read performance on local SQLite.
sqlite.pragma("journal_mode = WAL");
// Enforce foreign key constraints.
sqlite.pragma("foreign_keys = ON");

export const db = drizzle(sqlite, { schema });

const migrationsFolder = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "migrations"
);

// Auto-migrate on every startup. Safe to run repeatedly — only applies new migrations.
migrate(db, { migrationsFolder });
