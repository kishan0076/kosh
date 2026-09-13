import { lookup } from "node:dns/promises";
import ipaddr from "ipaddr.js";
import { AppError } from "../errors.js";

export interface SafeFetchResult {
  url: string;
  status: number;
  headers: Headers;
  body: string;
  bytes: Buffer;
}

const BLOCKED = () => new AppError("BLOCKED_URL", "That address is not reachable from Kosh.", 400);

async function assertPublic(hostname: string) {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) throw BLOCKED();
  let address: string;
  try {
    ({ address } = await lookup(host));
  } catch {
    throw BLOCKED();
  }
  // loopback, private, link-local (incl. cloud metadata 169.254.169.254), etc.
  if (ipaddr.process(address).range() !== "unicast") throw BLOCKED();
}

async function readCapped(res: Response, maxBytes: number): Promise<Buffer> {
  if (!res.body) return Buffer.alloc(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > maxBytes) {
        chunks.push(value.slice(0, value.byteLength - (total - maxBytes)));
        await reader.cancel();
        break;
      }
      chunks.push(value);
    }
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c)));
}

/**
 * Fetch a user-supplied URL with SSRF protection: http(s) only, DNS resolved and
 * checked to be public unicast on every hop, redirects followed manually and
 * re-checked, body size and time capped. (§5.3)
 */
export async function safeFetch(
  url: string,
  init: { maxBytes?: number; timeoutMs?: number; headers?: Record<string, string> } = {},
): Promise<SafeFetchResult> {
  let current: URL;
  try {
    current = new URL(url);
  } catch {
    throw new AppError("BLOCKED_URL", "Only http(s) links can be fetched.", 400);
  }

  for (let hop = 0; hop <= 3; hop++) {
    if (!/^https?:$/.test(current.protocol)) throw new AppError("BLOCKED_URL", "Only http(s) links can be fetched.", 400);
    await assertPublic(current.hostname);
    const res = await fetch(current, {
      headers: { "user-agent": "Kosh/1.0 (+https://kosh.app)", accept: "*/*", ...init.headers },
      redirect: "manual",
      signal: AbortSignal.timeout(init.timeoutMs ?? 8000),
    });
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const loc = res.headers.get("location");
      if (!loc) return { url: current.toString(), status: res.status, headers: res.headers, body: "", bytes: Buffer.alloc(0) };
      current = new URL(loc, current);
      continue;
    }
    const bytes = await readCapped(res, init.maxBytes ?? 2_000_000);
    return { url: current.toString(), status: res.status, headers: res.headers, body: bytes.toString("utf8"), bytes };
  }
  throw new AppError("TOO_MANY_REDIRECTS", "Too many redirects.", 400);
}
