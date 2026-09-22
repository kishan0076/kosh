import express, { type ErrorRequestHandler, type Express, type Router } from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
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
      contentSecurityPolicy: false, // JSON API; the web app ships its own CSP via apps/web/public/_headers
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
  // JSON everywhere EXCEPT the raw byte-upload endpoint, which reads the body as a Buffer.
  // (Without this skip, express.json consumes the stream first and direct uploads of any
  // application/json file fail hash verification.)
  const jsonParser = express.json({ limit: "2mb" });
  // Publishing inlines all project file bytes in the JSON body, so it needs a larger cap than the
  // 2 MB default (10 MB decoded → ~13.3 MB base64 + JSON overhead → 15 MB).
  const publishJsonParser = express.json({ limit: "15mb" });
  // Vault file/manifest bodies are base64 ciphertext (25 MB file → ~34 MB), well over the 2 MB default.
  const vaultJsonParser = express.json({ limit: "40mb" });
  app.use((req, res, next) => {
    if (req.path.startsWith("/api/uploads/local/")) return next(); // raw byte upload reads a Buffer
    if (req.path === "/api/repos/publish") return publishJsonParser(req, res, next);
    if (req.path.startsWith("/api/vault/")) return vaultJsonParser(req, res, next);
    return jsonParser(req, res, next);
  });
  app.use(cookieParser());
  app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === "/api/health" } }));

  const api: Router = express.Router();
  api.use(healthRouter);

  // Rate limits (§8). Generous global net + stricter caps on sensitive/expensive routes.
  const limiter = (limit: number) => rateLimit({ windowMs: 60_000, limit, standardHeaders: "draft-7", legacyHeaders: false });
  // Google's changes.watch webhook is unauthenticated and all pings share Google's source IPs — exempt
  // it from BOTH the global and the /drive-v2 per-IP buckets (it's guarded by the per-channel token).
  const isDriveWebhook = (path: string) => path.split("?")[0] === "/api/drive-v2/webhook/changes";
  api.use(rateLimit({ windowMs: 60_000, limit: 600, standardHeaders: "draft-7", legacyHeaders: false, skip: (req) => isDriveWebhook(req.originalUrl) }));
  api.use("/auth", limiter(30));
  api.use("/settings", limiter(30));
  api.use("/mcp", limiter(120));
  api.use("/email", limiter(30));
  api.use("/uploads", limiter(120));
  api.use("/repos", limiter(20));
  // The GitHub module (connect flow + repo listing/management) is chattier than publishing, so it gets
  // its own generous per-IP bucket rather than sharing the strict /repos publish limit.
  api.use("/github", limiter(120));
  api.use("/vault", limiter(60));
  api.use("/drive", limiter(120));
  // Google's changes.watch webhook is unauthenticated and all pings share Google's source IPs, so it
  // must NOT share the per-IP user bucket (a burst would 429 and drop change notifications). The route
  // itself is guarded by the per-channel token, and it only ever returns a fast 200.
  api.use(
    "/drive-v2",
    rateLimit({
      windowMs: 60_000,
      limit: 240,
      standardHeaders: "draft-7",
      legacyHeaders: false,
      skip: (req) => isDriveWebhook(req.originalUrl),
    }),
  );

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
    if ((err as { type?: string })?.type === "entity.too.large") {
      res.status(413).json({ error: { code: "TOO_LARGE", message: "That request is too large. Remove big files and try again." } });
      return;
    }
    logger.error({ err }, "unhandled error");
    res.status(500).json({ error: { code: "INTERNAL", message: "Something went wrong." } });
  };
  app.use(errorHandler);

  return app;
}
