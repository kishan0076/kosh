# Kosh email worker

Forwards inbound email to the Kosh API (`POST /api/email/inbound`) so newsletters and
forwards land in your Inbox with their links extracted. See build plan §9.5.

## Setup

1. `pnpm install` in this folder (or `npm install`).
2. Edit `wrangler.toml` → set `KOSH_API_URL` to your API's `/api` base.
3. `wrangler secret put EMAIL_INBOUND_SECRET` — use the **same** value as the API's
   `EMAIL_INBOUND_SECRET` env var.
4. `pnpm deploy`.
5. In the Cloudflare dashboard → **Email Routing**, route an address to this worker.
   Use your unguessable inbox token from **Settings → Ways in → Email-in**
   (e.g. `inbox+<your-token>@yourdomain.com`); the `+<token>` plus-tag tells the API
   which account to save to. Set `EMAIL_ALLOWED_SENDERS` on the API (required in
   production) so only senders you trust are accepted.

## Security

- The API rejects any request whose `x-kosh-email-secret` header doesn't match.
- Set `EMAIL_ALLOWED_SENDERS` on the API (comma-separated addresses or domains) to
  accept mail only from senders you trust. Leave it unset only in development.
