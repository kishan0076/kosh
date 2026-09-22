import { SignJWT, jwtVerify } from "jose";
import { config } from "../config.js";

const secret = new TextEncoder().encode(config.jwtSecret);
const ALG = "HS256";

export async function signSession(userId: string): Promise<string> {
  return new SignJWT({ uid: userId, typ: "session" })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(secret);
}

export async function verifySession(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, secret, { algorithms: [ALG] });
    // Token-type isolation: a purpose-scoped token (e.g. an OAuth `state`, which is deliberately
    // placed in a URL) must NEVER be promotable to a session credential. Only accept session tokens.
    if (payload.purpose !== undefined) return null;
    return typeof payload.uid === "string" ? payload.uid : null;
  } catch {
    return null;
  }
}

export const SESSION_COOKIE = "kosh_session";

/** Sign a short-lived, purpose-scoped token for an OAuth `state` (CSRF binding to the user).
 *  `from` optionally records where the flow began, so the callback can return there. */
export async function signState(userId: string, purpose: string, from?: string): Promise<string> {
  return new SignJWT({ uid: userId, purpose, ...(from ? { from } : {}) })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(secret);
}

/** Verify an OAuth `state` token; returns the bound userId (+ optional `from`) only if the purpose matches. */
export async function verifyState(token: string, purpose: string): Promise<{ uid: string; from?: string } | null> {
  try {
    const { payload } = await jwtVerify(token, secret, { algorithms: [ALG] });
    if (payload.purpose !== purpose || typeof payload.uid !== "string") return null;
    return { uid: payload.uid, from: typeof payload.from === "string" ? payload.from : undefined };
  } catch {
    return null;
  }
}
