import { SignJWT, jwtVerify } from "jose";
import { config } from "../config.js";

const secret = new TextEncoder().encode(config.jwtSecret);
const ALG = "HS256";

export async function signSession(userId: string): Promise<string> {
  return new SignJWT({ uid: userId })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(secret);
}

export async function verifySession(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, secret, { algorithms: [ALG] });
    return typeof payload.uid === "string" ? payload.uid : null;
  } catch {
    return null;
  }
}

export const SESSION_COOKIE = "kosh_session";

/** Sign a short-lived, purpose-scoped token for an OAuth `state` (CSRF binding to the user). */
export async function signState(userId: string, purpose: string): Promise<string> {
  return new SignJWT({ uid: userId, purpose })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(secret);
}

/** Verify an OAuth `state` token; returns the userId only if the purpose matches. */
export async function verifyState(token: string, purpose: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, secret, { algorithms: [ALG] });
    return payload.purpose === purpose && typeof payload.uid === "string" ? payload.uid : null;
  } catch {
    return null;
  }
}
