import { Hono } from "hono";
import { runLibrarySync } from "../services/library.js";

const app = new Hono();

// In-flight sync promise — deduplicates concurrent requests to avoid
// SQLite UNIQUE constraint violations and redundant I/O.
let syncInFlight: Promise<void> | null = null;

/**
 * POST /api/library/sync — trigger Library Sync manually.
 * Returns 202 immediately; sync runs in the background.
 * If a sync is already in progress, the request is coalesced into it.
 */
app.post("/api/library/sync", (c) => {
  if (!syncInFlight) {
    syncInFlight = runLibrarySync()
      .then((summary) => {
        console.log(
          `[library-sync] completed: ${summary.newCount} new, ${summary.updatedCount} updated, ${summary.missingCount} missing, ${summary.ambiguousCount} ambiguous, ${summary.failedCount} failed`,
        );
      })
      .catch((err: unknown) => {
        console.error("[library-sync] error:", String(err));
      })
      .finally(() => {
        syncInFlight = null;
      });
  }

  return c.json({ status: "sync_started" }, 202);
});

export default app;
