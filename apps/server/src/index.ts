import { serve } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import { Hono } from "hono";
import { healthResponseSchema, type HealthResponse } from "@podcraft/shared";
// Initialize DB and run pending migrations on startup.
import "./db/index.js";
// Initialize BullMQ worker (side-effect: starts consuming jobs from Redis queue).
import "./jobs/worker.js";
import { config } from "./config.js";
import recordingsRoutes from "./routes/recordings.js";
import libraryRoutes from "./routes/library-routes.js";
import filesRoutes from "./routes/files.js";
import transcriptionRoutes from "./routes/transcription-routes.js";
import createWsRoutes from "./routes/ws-routes.js";

const app = new Hono();
const nodeWebSocket = createNodeWebSocket({ app });
const upgradeWebSocket = nodeWebSocket.upgradeWebSocket.bind(nodeWebSocket);

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
app.route("/", transcriptionRoutes);
app.route("/", createWsRoutes(upgradeWebSocket));

const server = serve(
  {
    fetch: app.fetch,
    port: config.port,
  },
  (info) => {
    console.log(`PodCraft server listening on http://localhost:${info.port}`);
  },
);

nodeWebSocket.injectWebSocket(server);
