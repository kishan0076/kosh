# Secure Vault — admin-only, end-to-end-encrypted secrets

The Secure Vault is a private, admin-only module for storing personal secrets, private notes,
screenshots and documents. It is built around **client-side end-to-end encryption (E2EE)**: your
data is encrypted **in your browser** with a key derived from your master password, so the server
and the storage bucket only ever hold **ciphertext**. Nobody — not the database, not the storage
provider, not the app operator — can read your secrets without your master password.

> **First, a clarification.** Your Kosh data lives in **your** database/storage, not in
> "Claude's storage." Even so, your instinct is correct: with E2EE the *location* of the encrypted
> blob barely matters, because it's unreadable without your password. We also keep the vault's data
> in a **separate store** from the rest of the app, never in MongoDB.

---

## 1. Security model at a glance

```
  Your browser                              Kosh API (admin-only)         Separate vault storage
  ───────────                               ─────────────────────         ──────────────────────
  master password ─PBKDF2(600k)→ AES-256 key   (never sees the key         .vault-data/  OR  its
        │                          │            or any plaintext)          own R2/S3 bucket
        ▼                          ▼                                        (ciphertext only)
   encrypt notes / secrets / files ──► ciphertext ──► PUT /api/vault/* ──► u/<you>/vault/…
   decrypt in memory only ◄────────── ciphertext ◄── GET /api/vault/* ◄───
```

- **The master password never leaves the browser.** It is stretched with **PBKDF2-HMAC-SHA256
  (600,000 iterations)** into a **non-extractable AES-256-GCM key** that exists only in memory.
- **Everything stored is ciphertext.** Notes, secret values, file names, file bytes — all encrypted
  client-side (AES-256-GCM, random IV per item) before they're uploaded.
- **Admin-only.** Every vault endpoint is gated to the admin account (server-side), *and* the data
  is useless without the master password (client-side). Two independent layers.
- **Separate storage.** Vault ciphertext is written to its **own directory** (`VAULT_DIR`, default
  `.vault-data/`, separate from `DATA_DIR`) or its **own R2/S3 bucket** — **never** MongoDB and
  never the main object store.
- **Auto-lock.** The vault locks after inactivity and on tab-hide/navigation; the key and all
  decrypted data are dropped from memory.

---

## 2. Threat model — what it protects, and what it does not

**Protects against**
- A compromised or curious **database/storage** (Mongo dump, stolen bucket, backups) — attackers get
  only AES-GCM ciphertext + a salt; no plaintext, no key.
- A **non-admin user** of the app — the server refuses vault endpoints to anyone but the admin.
- **Network snooping** — everything is ciphertext in transit too (use HTTPS in production).
- The **app operator** reading your data at rest — they never receive the key or plaintext.

**Does NOT protect against (be honest with yourself here)**
- **A forgotten master password** — there is **no recovery**. If you lose it, the data is
  permanently unreadable. This is the price of real E2EE. Keep the password somewhere safe offline.
- **A compromised browser / malicious frontend / XSS** — code running in your page at unlock time can
  read decrypted data. Mitigations in place: a strict Content-Security-Policy (`script-src 'self'`,
  no inline scripts), no third-party crypto libraries (native WebCrypto only), no plaintext logging,
  the key is never persisted, and auto-lock.
- **Offline brute-force of a weak password** — an attacker who steals the ciphertext can guess
  passwords offline. The 600k-iteration KDF makes this expensive; **a strong, unique master password
  is your real defense.**
- **Shoulder-surfing / a compromised device** — E2EE can't help if someone is watching your screen
  or controls your machine.

---

## 3. Give yourself admin access

Set the admin login (the GitHub login / dev-login username that may open the vault):

```dotenv
KOSH_ADMIN_LOGIN=your-github-login
```

Resolution order: `KOSH_ADMIN_LOGIN` → the first entry of `ALLOWED_GITHUB_LOGINS` → and, **only in
non-production local dev**, any dev-login user (single-user convenience). The gate **fails closed**:
if no admin login is configured in production, the vault is inaccessible rather than open to everyone,
and the API **refuses to start in production with `DEV_LOGIN` enabled**. Still, **always set
`KOSH_ADMIN_LOGIN` in production.** When you're the admin, a **Secure Vault** entry appears in your
account menu (top-right); it's otherwise hidden and reachable only at `/vault`.

---

## 4. Where the encrypted data is stored (and how to pick a platform)

Because everything is E2EE ciphertext, **any** of these is safe. Pick by convenience:

### Option A — Local separate directory (default, free, zero setup)
Out of the box, vault ciphertext goes to `VAULT_DIR` (default `.vault-data/`), a directory **separate
from** the app's `DATA_DIR`. It never touches MongoDB. For extra safety, point `VAULT_DIR` at an
OS-encrypted volume (FileVault / LUKS / BitLocker):

```dotenv
VAULT_DIR=/mnt/encrypted-volume/kosh-vault
```

### Option B — Cloudflare R2 (recommended free hosted option) ⭐
R2 has a generous free tier (10 GB storage, no egress fees) and is S3-compatible. Keep it in its
**own bucket**, isolated from the app's object store.

1. Sign in at <https://dash.cloudflare.com> → **R2** → **Create bucket** → name it e.g. `kosh-vault`.
2. **R2 → Manage R2 API Tokens → Create API Token**: give it **Object Read & Write** scoped to the
   `kosh-vault` bucket only. Copy the **Access Key ID**, **Secret Access Key**, and your **Account ID**.
3. Add to the repo-root `.env`:
   ```dotenv
   R2_ACCOUNT_ID=<your-account-id>
   R2_ACCESS_KEY_ID=<access-key-id>
   R2_SECRET_ACCESS_KEY=<secret-access-key>
   VAULT_R2_BUCKET=kosh-vault      # a DIFFERENT bucket than R2_BUCKET (the app's object store)
   ```
4. Restart the API. Vault blobs now go to the `kosh-vault` bucket; the app's own files stay in
   `R2_BUCKET`. Since only ciphertext is uploaded, an R2 breach reveals nothing readable.

### Option C — Backblaze B2 (free 10 GB, S3-compatible)
1. Create a Backblaze account → **B2 Cloud Storage** → **Create a Bucket** (`kosh-vault`, private).
2. **App Keys → Add a New Application Key**, restricted to that bucket; note the **keyID**,
   **applicationKey**, and the **S3 endpoint** (e.g. `https://s3.us-west-004.backblazeb2.com`).
3. In `.env`, point the S3 client at B2 and use a separate vault bucket:
   ```dotenv
   R2_ENDPOINT=https://s3.us-west-004.backblazeb2.com
   R2_ACCESS_KEY_ID=<keyID>
   R2_SECRET_ACCESS_KEY=<applicationKey>
   VAULT_R2_BUCKET=kosh-vault
   ```

> **Not recommended:** a separate MongoDB collection (you asked specifically to avoid Mongo), or any
> service where you'd have to trust the provider with plaintext — you never do here, but object
> storage is simpler and cheaper for blobs than a database.

---

## 5. Technologies & APIs used

- **Encryption:** native **WebCrypto** (`crypto.subtle`) — PBKDF2-SHA-256 (600k) for key derivation,
  AES-256-GCM for encryption. No external crypto libraries (keeps the CSP `script-src 'self'`).
  See `apps/web/src/lib/vaultCrypto.ts`.
- **Client state:** an ephemeral Zustand store (`apps/web/src/data/vault.ts`) that holds the key and
  decrypted index **in memory only** — never persisted to `localStorage`/`IndexedDB`.
- **API:** admin-gated Express routes (`apps/api/src/routes/vault.ts`):
  `GET/PUT /api/vault/manifest` (the encrypted index + KDF salt + verifier) and
  `POST/GET/DELETE /api/vault/files/:id` (encrypted file blobs). All payloads are opaque ciphertext.
- **Storage:** `apps/api/src/vault/storage.ts` — isolated local dir or a dedicated R2/S3 bucket.

---

## 6. Using the vault

1. Open **Secure Vault** from the account menu (admin only) or go to `/vault`.
2. **First run:** create a master password (with a strength meter and an "it can't be recovered"
   acknowledgement). This derives your key and initializes an empty encrypted vault.
3. **Add items:** notes, secrets (key/value, with reveal + copy), or files/screenshots (encrypted in
   the browser before upload; images preview inline after decryption).
4. **Organize:** assign a **category** (sidebar grouping) and an optional **folder**; **search**
   filters across all decrypted items instantly (titles, categories, folders, notes, file names).
5. **Copy safety:** copying a secret shows a "clears in 20s" toast and best-effort wipes the clipboard.
6. **Lock:** press **Lock** any time; the vault also auto-locks after ~5 minutes of inactivity and on
   tab-hide — the key and plaintext leave memory, and re-entry needs the master password.

---

## 7. Upgrade path (optional hardening)

The current design is secure for a personal single-user vault. If you want to go further:

- **Argon2id KDF** (memory-hard) instead of PBKDF2 — needs a WASM lib and a small CSP allowance for
  `wasm-unsafe-eval`; the KDF params are stored per-vault so you can raise them without breaking
  existing data.
- **KEK/DEK key hierarchy** — wrap a random data key under the password-derived key so changing the
  master password is O(1) (re-wrap one key) instead of re-encrypting everything.
- **Web Worker for the KDF** so the ~0.5s derivation never janks the UI.
- **Chunked streaming encryption** for very large files (raise the 25 MB cap).
- **Hardware-backed unlock** (WebAuthn/passkey) as a second factor on top of the master password.
