import PostalMime from "postal-mime";

/**
 * Cloudflare Email Worker (§9.5).
 * Bind an address in Cloudflare Email Routing to this worker; it parses the message
 * and forwards the essentials to the Kosh API's POST /email/inbound with a shared secret.
 *
 * Required vars (wrangler.toml [vars] / secrets):
 *   KOSH_API_URL         e.g. https://api.yourdomain.com/api
 *   EMAIL_INBOUND_SECRET must equal the API's EMAIL_INBOUND_SECRET
 */
export default {
  async email(message, env, ctx) {
    const parsed = await PostalMime.parse(message.raw);
    const payload = {
      from: message.from,
      fromName: parsed.from?.name || undefined,
      to: message.to,
      subject: parsed.subject || message.headers.get("subject") || undefined,
      text: parsed.text || undefined,
      html: parsed.html || undefined,
    };

    ctx.waitUntil(
      fetch(`${env.KOSH_API_URL}/email/inbound`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-kosh-email-secret": env.EMAIL_INBOUND_SECRET },
        body: JSON.stringify(payload),
      }).catch(() => {}),
    );
  },
};
