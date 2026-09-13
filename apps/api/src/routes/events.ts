import { Router } from "express";
import { requireUser } from "../auth/middleware.js";
import { subscribe } from "../events.js";

export const eventsRouter: Router = Router();

eventsRouter.get("/events", (req, res) => {
  const userId = requireUser(req);
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write("retry: 3000\n\n");
  res.write(`data: ${JSON.stringify({ kind: "connected" })}\n\n`);

  const unsubscribe = subscribe(userId, res);
  const heartbeat = setInterval(() => {
    try {
      res.write(": ping\n\n");
    } catch {
      /* ignore */
    }
  }, 25_000);

  req.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});
