import type { NextFunction, Request, Response } from "express";
import { getStore, type ServerUser } from "../db/index.js";
import { unauthorized, forbidden } from "../errors.js";
import { SESSION_COOKIE, verifySession } from "./jwt.js";
import { hashApiKey } from "./apikey.js";
import { isAdmin } from "./users.js";

/** Attach req.userId from a Bearer API key, a Bearer SESSION token, or the session cookie (best-effort).
 *  The Bearer session path exists for the native mobile app (Capacitor): a WebView on
 *  capacitor://localhost can't reliably carry a cross-site cookie to the API host, so it stores the same
 *  signed session JWT the cookie would hold and sends it as a header instead.
 *
 *  Whichever path resolves an id, the account is loaded and a DISABLED account is treated as anonymous —
 *  so an admin disabling a user locks them out immediately, even with a still-valid session cookie. */
export async function attachUser(req: Request, _res: Response, next: NextFunction) {
  try {
    let uid: string | null = null;
    let scopes: ("read" | "write")[] | undefined;
    let kind: "apikey" | "session" | undefined;

    const auth = req.header("authorization");
    if (auth?.startsWith("Bearer ")) {
      const key = auth.slice(7).trim();
      const record = await getStore().apiKeys.findOne({ keyHash: hashApiKey(key), revokedAt: null });
      if (record) {
        uid = record.userId;
        scopes = record.scopes;
        kind = "apikey";
        void getStore().apiKeys.updateById(record.id, { lastUsedAt: new Date().toISOString() });
      } else {
        // Not an API key — maybe a session JWT (mobile). verifySession refuses purpose-scoped tokens.
        const sid = key.startsWith("ksh_") ? null : await verifySession(key);
        if (sid) {
          uid = sid;
          scopes = ["read", "write"];
          kind = "session";
        }
      }
    }
    if (!uid) {
      const token = req.cookies?.[SESSION_COOKIE];
      if (token) {
        const sid = await verifySession(token);
        if (sid) {
          uid = sid;
          scopes = ["read", "write"];
          kind = "session";
        }
      }
    }
    if (uid) {
      const user = await getStore().users.findById(uid);
      if (user && !user.disabled) {
        req.userId = uid;
        req.apiScopes = scopes;
        req.authKind = kind;
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

/** Require an authenticated, write-scoped admin. Returns the resolved admin user. */
export async function requireAdmin(req: Request): Promise<{ uid: string; user: ServerUser }> {
  const uid = requireWrite(req);
  const user = await getStore().users.findById(uid);
  if (!isAdmin(user)) throw forbidden("Admins only.");
  return { uid, user: user! };
}
