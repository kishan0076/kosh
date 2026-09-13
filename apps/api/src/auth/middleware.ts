import type { NextFunction, Request, Response } from "express";
import { getStore } from "../db/index.js";
import { unauthorized, forbidden } from "../errors.js";
import { SESSION_COOKIE, verifySession } from "./jwt.js";
import { hashApiKey } from "./apikey.js";

/** Attach req.userId from a Bearer API key or the session cookie (best-effort). */
export async function attachUser(req: Request, _res: Response, next: NextFunction) {
  try {
    const auth = req.header("authorization");
    if (auth?.startsWith("Bearer ")) {
      const key = auth.slice(7).trim();
      const record = await getStore().apiKeys.findOne({ keyHash: hashApiKey(key), revokedAt: null });
      if (record) {
        req.userId = record.userId;
        req.apiScopes = record.scopes;
        req.authKind = "apikey";
        void getStore().apiKeys.updateById(record.id, { lastUsedAt: new Date().toISOString() });
        return next();
      }
    }
    const token = req.cookies?.[SESSION_COOKIE];
    if (token) {
      const uid = await verifySession(token);
      if (uid) {
        req.userId = uid;
        req.apiScopes = ["read", "write"];
        req.authKind = "session";
      }
    }
  } catch {
    /* ignore — treated as anonymous */
  }
  next();
}

export function requireUser(req: Request): string {
  if (!req.userId) throw unauthorized();
  return req.userId;
}

export function requireWrite(req: Request): string {
  const uid = requireUser(req);
  if (req.authKind === "apikey" && !req.apiScopes?.includes("write")) throw forbidden("This API key is read-only.");
  return uid;
}
