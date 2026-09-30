import { Router } from "express";
import { safeFetch } from "../integrations/safe-fetch.js";
import { ah, badRequest } from "../errors.js";

export const imgRouter: Router = Router();

// Only RASTER image types are proxied. image/svg+xml is deliberately excluded: this route is
// unauthenticated and served from the API origin (which carries the session cookie and runs with CSP
// disabled), so echoing an attacker-supplied SVG inline would let embedded <script> execute same-origin
// (XSS -> account takeover). Raster formats can't carry active content.
const SAFE_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/bmp",
  "image/x-icon",
  "image/vnd.microsoft.icon",
  "image/tiff",
]);

/** Proxy an Open Graph image through safeFetch (never hot-linked). */
imgRouter.get(
  "/img",
  ah(async (req, res) => {
    const u = String(req.query.u ?? "");
    if (!u) throw badRequest("MISSING_URL", "Provide ?u=<image url>.");
    const r = await safeFetch(u, { maxBytes: 5_000_000, timeoutMs: 8000 });
    const type = ((r.headers.get("content-type") ?? "").split(";")[0] ?? "").trim().toLowerCase();
    if (!SAFE_IMAGE_TYPES.has(type)) throw badRequest("NOT_IMAGE", "That URL is not a supported image type.");
    res.setHeader("Content-Type", type);
    // Defense-in-depth even though only raster types reach here: never sniff, and render the response inert
    // if a browser somehow treats it as a document.
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.send(r.bytes);
  }),
);
