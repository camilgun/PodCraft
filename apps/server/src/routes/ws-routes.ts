import { Hono } from "hono";
import type { UpgradeWebSocket } from "hono/ws";
import { wsManager } from "../services/ws.js";

export default function createWsRoutes(upgradeWebSocket: UpgradeWebSocket): Hono {
  const app = new Hono();

  app.get(
    "/api/recordings/:id/ws",
    upgradeWebSocket((context) => {
      const recordingId = context.req.param("id");

      return {
        onOpen: (_event, ws) => {
          wsManager.connect(recordingId, ws);
        },
        onClose: (_event, ws) => {
          wsManager.disconnect(recordingId, ws);
        },
        onError: (_event, ws) => {
          wsManager.disconnect(recordingId, ws);
        },
      };
    }),
  );

  return app;
}
