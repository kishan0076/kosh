import { createHash, randomBytes } from "node:crypto";

const PREFIX = "ksh_";

/** Generate a new API key: returns the plaintext (shown once) and its hash. */
export function generateApiKey(): { key: string; prefix: string; hash: string } {
  const raw = randomBytes(24).toString("base64url");
  const key = `${PREFIX}${raw}`;
  return { key, prefix: key.slice(0, 8), hash: hashApiKey(key) };
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}
