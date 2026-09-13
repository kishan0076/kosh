import { Router } from "express";
import { z } from "zod";
import { config } from "../config.js";
import { ah, badRequest, forbidden } from "../errors.js";
import { getStore } from "../db/index.js";
import { ingest } from "../modules/ingest.js";

export const emailRouter: Router = Router();

const URL_RE = /https?:\/\/[^\s"'<>)]+/gi;
const stripHtml = (html: string) => html.replace(/<[^>]+>/g, " ");
const domainOf = (addr: string) => addr.split("@")[1]?.toLowerCase() ?? "";

const bodySchema = z.object({
  from: z.string().email(),
  fromName: z.string().max(200).optional(),
  to: z.string().max(320).optional(),
  subject: z.string().max(2000).optional(),
  text: z.string().max(500_000).optional(),
  html: z.string().max(1_000_000).optional(),
});

function senderAllowed(from: string): boolean {
  const list = config.email.allowedSenders;
  if (!list.length) return true; // dev: accept any
  const addr = from.toLowerCase();
  return list.some((entry) => addr === entry || domainOf(addr) === entry || addr.endsWith(`@${entry}`));
}

/** POST /email/inbound — Cloudflare Email Routing → worker → here (shared secret). (§9.5)
 *  Extracts links from a forwarded email and drops them in the Inbox as source:"email". */
emailRouter.post(
  "/email/inbound",
  ah(async (req, res) => {
    if (!config.email.inboundSecret) {
      res.json({ ok: true, note: "Email-in not configured (set EMAIL_INBOUND_SECRET)." });
      return;
    }
    if (req.header("x-kosh-email-secret") !== config.email.inboundSecret) {
      res.status(401).json({ error: { code: "BAD_SECRET", message: "Invalid email secret." } });
      return;
    }
    const body = bodySchema.parse(req.body);
    if (!senderAllowed(body.from)) throw forbidden("This sender isn't on your allowlist.");

    // Resolve the target user: a plus-tag (kosh+<login>@…) wins; otherwise the sole user.
    const users = await getStore().users.find({});
    const plus = body.to?.match(/\+([a-z0-9_-]+)@/i)?.[1];
    const user = plus ? users.find((u) => u.login === plus) : users.length === 1 ? users[0] : undefined;
    if (!user) throw badRequest("NO_USER", "Couldn't match this email to a Kosh account.");

    const haystack = `${body.subject ?? ""}\n${body.text ?? (body.html ? stripHtml(body.html) : "")}`;
    const urls = [...new Set((haystack.match(URL_RE) ?? []).map((u) => u.replace(/[).,;]+$/, "")))];
    const label = body.fromName || body.from;
    const tag = `newsletter/${domainOf(body.from)}`;

    let saved = 0;
    let skipped = 0;
    for (const url of urls.slice(0, 200)) {
      const { duplicate } = await ingest(user.id, url, { source: "email", foundVia: { kind: "email", label }, tags: [tag] });
      duplicate ? skipped++ : saved++;
    }
    res.json({ found: urls.length, saved, skipped });
  }),
);
