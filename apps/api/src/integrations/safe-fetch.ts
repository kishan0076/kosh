import { lookup as dnsLookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { Readable } from "node:stream";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
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

function isPublicUnicast(address: string): boolean {
  try {
    return ipaddr.process(address).range() === "unicast";
  } catch {
    return false;
  }
}

function isBlockedName(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "localhost" || host.endsWith(".local") || host.endsWith(".internal");
}

/**
 * Resolve a hostname and return the addresses that are public unicast. The list is
 * used to PIN the connection to a validated IP so the address we vetted is exactly
 * the address we connect to — the resolve-then-fetch-by-name gap (DNS rebinding /
 * multi-record TOCTOU) is closed. Every returned record is checked, not just the first.
 */
async function resolvePublic(hostname: string): Promise<{ address: string; family: number }[]> {
  if (isBlockedName(hostname)) throw BLOCKED();
  let records: { address: string; family: number }[];
  try {
    records = await dnsLookup(hostname, { all: true });
  } catch {
    throw BLOCKED();
  }
  const valid = records.filter((r) => isPublicUnicast(r.address));
  if (valid.length === 0) throw BLOCKED();
  return valid;
}

function decompress(res: http.IncomingMessage): Readable {
  const enc = (res.headers["content-encoding"] || "").toString().toLowerCase();
  if (enc === "gzip") return res.pipe(createGunzip());
  if (enc === "deflate") return res.pipe(createInflate());
  if (enc === "br") return res.pipe(createBrotliDecompress());
  return res;
}

function readCapped(stream: Readable, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    stream.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        chunks.push(chunk.subarray(0, chunk.length - (total - maxBytes)));
        stream.destroy();
        resolve(Buffer.concat(chunks));
        return;
      }
      chunks.push(chunk);
    });
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", (err) => {
      // A truncation destroy() shows up as a premature-close error after we already resolved; ignore it.
      if ((err as NodeJS.ErrnoException).code === "ERR_STREAM_PREMATURE_CLOSE") return;
      reject(err);
    });
  });
}

interface HopResult {
  status: number;
  headers: Headers;
  bytes: Buffer;
}

/** One HTTP(S) request that connects ONLY to `pinned` (a pre-validated IP), never re-resolving by name. */
function requestPinned(
  current: URL,
  pinned: { address: string; family: number },
  init: { maxBytes: number; timeoutMs: number; headers?: Record<string, string> },
): Promise<HopResult> {
  return new Promise((resolve, reject) => {
    const mod = current.protocol === "https:" ? https : http;
    const req = mod.request(
      current,
      {
        method: "GET",
        headers: { "user-agent": "Kosh/1.0 (+https://kosh.app)", accept: "*/*", "accept-encoding": "gzip, deflate, br", ...init.headers },
        // Pin the socket to the address we already vetted; the TLS SNI / Host header stay the hostname
        // so certificate validation is unaffected. This is what defeats DNS-rebinding SSRF.
        lookup: (_hostname: string, _options: unknown, cb: (err: Error | null, address: string, family: number) => void) =>
          cb(null, pinned.address, pinned.family),
        timeout: init.timeoutMs,
      },
      (res) => {
        const headers = new Headers();
        for (const [key, value] of Object.entries(res.headers)) {
          if (value === undefined) continue;
          if (Array.isArray(value)) for (const v of value) headers.append(key, v);
          else headers.set(key, value);
        }
        const status = res.statusCode ?? 0;
        // Don't download the body of a redirect — we only need its Location header.
        if ([301, 302, 303, 307, 308].includes(status)) {
          res.resume();
          resolve({ status, headers, bytes: Buffer.alloc(0) });
          return;
        }
        readCapped(decompress(res), init.maxBytes)
          .then((bytes) => resolve({ status, headers, bytes }))
          .catch(reject);
      },
    );
    req.on("timeout", () => req.destroy(new AppError("TIMEOUT", "That address took too long to respond.", 400)));
    req.on("error", (err) => reject(err instanceof AppError ? err : BLOCKED()));
    req.end();
  });
}

/**
 * Fetch a user-supplied URL with SSRF protection: http(s) only, DNS resolved and
 * checked to be public unicast on every hop, the connection PINNED to the vetted IP
 * (so the checked address is the connected address — no rebinding gap), redirects
 * followed manually and re-checked, body size and time capped. (§5.3)
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

  const maxBytes = init.maxBytes ?? 2_000_000;
  const timeoutMs = init.timeoutMs ?? 8000;

  for (let hop = 0; hop <= 3; hop++) {
    if (!/^https?:$/.test(current.protocol)) throw new AppError("BLOCKED_URL", "Only http(s) links can be fetched.", 400);
    const pinned = (await resolvePublic(current.hostname))[0]!; // resolvePublic throws when there is no valid address
    const res = await requestPinned(current, pinned, { maxBytes, timeoutMs, headers: init.headers });
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const loc = res.headers.get("location");
      if (!loc) return { url: current.toString(), status: res.status, headers: res.headers, body: "", bytes: Buffer.alloc(0) };
      current = new URL(loc, current);
      continue;
    }
    return { url: current.toString(), status: res.status, headers: res.headers, body: res.bytes.toString("utf8"), bytes: res.bytes };
  }
  throw new AppError("TOO_MANY_REDIRECTS", "Too many redirects.", 400);
}

// Re-exported so callers/tests can reuse the exact public-unicast rule.
export { isPublicUnicast, resolvePublic };
