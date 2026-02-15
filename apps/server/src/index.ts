import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { healthResponseSchema, type HealthResponse } from "@podcraft/shared";

const app = new Hono();

app.get("/", (context) => {
  return context.text("PodCraft server running");
});

app.get("/health", (context) => {
  const payload: HealthResponse = {
    status: "ok"
  };

  const parsedPayload = healthResponseSchema.safeParse(payload);
  if (!parsedPayload.success) {
    throw new Error("Invalid /health payload");
  }

  return context.json(parsedPayload.data);
});

const port = 4000;

serve(
  {
    fetch: app.fetch,
    port
  },
  (info) => {
    console.log(`PodCraft server listening on http://localhost:${info.port}`);
  }
);
