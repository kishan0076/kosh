import express, { type ErrorRequestHandler, type Express, type Router } from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { ZodError } from "zod";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { AppError } from "./errors.js";
import { attachUser } from "./auth/middleware.js";
import { healthRouter } from "./routes/health.js";
import { mountRoutes } from "./routes/index.js";

export function createApp(): Express {
  const app = express();
  app.set("trust proxy", 1);

  app.use(
    helmet({
      contentSecurityPolicy: false, // JSON API; the web app sets its own CSP
      crossOriginResourcePolicy: { policy: "cross-origin" },
    }),
  );
  app.use(
    cors({
      origin: [config.appUrl],
      credentials: true,
      allowedHeaders: ["Content-Type", "Authorization"],
    }),
  );
  app.use(express.json({ limit: "2mb" }));
  app.use(cookieParser());
  app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === "/api/health" } }));

  const api: Router = express.Router();
  api.use(healthRouter);
  api.use(attachUser);
  mountRoutes(api);
  app.use("/api", api);

  app.use((_req, res) => res.status(404).json({ error: { code: "NOT_FOUND", message: "Route not found." } }));

  const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
    if (err instanceof AppError) {
      res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
      return;
    }
    if (err instanceof ZodError) {
      res.status(400).json({ error: { code: "VALIDATION", message: "Invalid request.", details: err.flatten() } });
      return;
    }
    logger.error({ err }, "unhandled error");
    res.status(500).json({ error: { code: "INTERNAL", message: "Something went wrong." } });
  };
  app.use(errorHandler);

  return app;
}
