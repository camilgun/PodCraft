import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { healthResponseSchema, type HealthResponse } from "@podcraft/shared";
// Initialize DB and run pending migrations on startup.
import "./db/index.js";
import { config } from "./config.js";
import recordingsRoutes from "./routes/recordings.js";
import libraryRoutes from "./routes/library-routes.js";
import filesRoutes from "./routes/files.js";

const app = new Hono();

app.get("/", (context) => {
  return context.text("PodCraft server running");
});

app.get("/health", (context) => {
  const payload: HealthResponse = {
    status: "ok",
  };

  const parsedPayload = healthResponseSchema.safeParse(payload);
  if (!parsedPayload.success) {
    throw new Error("Invalid /health payload");
  }

  return context.json(parsedPayload.data);
});

app.route("/", recordingsRoutes);
app.route("/", libraryRoutes);
app.route("/", filesRoutes);

serve(
  {
    fetch: app.fetch,
    port: config.port,
  },
  (info) => {
    console.log(`PodCraft server listening on http://localhost:${info.port}`);
  },
);
