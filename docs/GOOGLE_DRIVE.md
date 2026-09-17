# Google Drive integration

Upload files and whole folders from Kosh straight to your Google Drive — with live progress,
pause/resume, retry, duplicate detection, multi-account support, folder management, upload history,
and storage-usage insight.

This module is built on **least privilege** and a **bytes-never-touch-our-server** design: file bytes
stream from your browser **directly to Google**; the Kosh API only handles OAuth and small metadata
calls. It mirrors Kosh's existing presigned-R2 direct-upload path.

---

## 1. How it works (architecture)

```
  Browser (React)                     Kosh API (Express)                 Google
  ───────────────                     ──────────────────                 ──────
  "Sign in with Google" ───────────►  GET /drive/auth  ───────────────►  consent screen
  (redirect back) ◄─────────────────  GET /drive/auth/callback ◄───────  code
                                       exchange code → REFRESH token
                                       encrypt + store (AES-256-GCM)
  need to upload ──────────────────►  POST /drive/accounts/:id/token
  short-lived access token  ◄────────  (mint from refresh token)
  PUT file bytes (resumable)  ───────────────────────────────────────►  Drive (upload endpoint)
  folder list / quota / dup-check ─►  GET/POST /drive/accounts/:id/*  ─►  Drive API (proxied)
  record result ───────────────────►  POST /drive/uploads (history)
```

- **The refresh token never leaves the server** and is encrypted at rest (same `ENCRYPTION_KEY` +
  AES-256-GCM used for GitHub tokens). It is **never** returned by any endpoint.
- **The browser only ever holds a short-lived access token** (~1 hour, `drive.file` scope by default),
  used solely for the direct upload to Google.
- **File bytes never pass through the Kosh API.** Uploads go browser → Google via the resumable
  protocol, so there's no server bandwidth cost and progress/pause/resume work natively.

---

## 2. Google Cloud Console setup (one-time)

1. **Create/select a project** at <https://console.cloud.google.com>.
2. **APIs & Services → Library → enable “Google Drive API.”**
3. **OAuth consent screen:**
   - User type **External** (or **Internal** if this is a same-domain Google Workspace tool — Internal
     skips verification entirely).
   - Fill app name, support email, developer email.
   - Add exactly these **non-sensitive** scopes: `openid`, `.../auth/userinfo.email`,
     `.../auth/userinfo.profile`, `.../auth/drive.file`.
   - While in **Testing**, add your Google address under **Test users**.
4. **Credentials → Create credentials → OAuth client ID → Web application:**
   - **Authorized redirect URI** must match `config.google.redirectUri` **byte-for-byte**, i.e.
     `<API_URL>/api/drive/auth/callback` (default `http://localhost:8787/api/drive/auth/callback`).
   - Copy the **Client ID** and **Client secret**.
5. **Add them to your repo-root `.env`:**
   ```dotenv
   GOOGLE_CLIENT_ID=<client-id>
   GOOGLE_CLIENT_SECRET=<client-secret>
   # Optional — only if your API URL differs from the default:
   # GOOGLE_REDIRECT_URI=https://your-api/api/drive/auth/callback
   ```
6. **Publishing:** a `drive.file`-only app can move to **Production without a security review**. A Google
   verification + CASA security assessment is required **only** if you set `GOOGLE_DRIVE_FULL_ACCESS=1`
   (see below), which requests the restricted full-`drive` scope.

Restart the API. Open **Google Drive** in the sidebar and click **Sign in with Google**.

---

## 3. Environment variables

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `GOOGLE_CLIENT_ID` | to enable | — | OAuth client id. Unset → the module runs in a "connect Google" demo gate. |
| `GOOGLE_CLIENT_SECRET` | to enable | — | OAuth client secret. |
| `GOOGLE_REDIRECT_URI` | no | `${API_URL}/api/drive/auth/callback` | Must match the console **exactly**. |
| `GOOGLE_DRIVE_FULL_ACCESS` | no | `0` | `0` = least-privilege `drive.file` (no verification). `1` = restricted full `drive` scope to browse **all** existing folders (**requires Google verification**). |
| `ENCRYPTION_KEY` | yes (already) | — | Reused to encrypt the stored refresh token at rest. |

> There is **no** `GOOGLE_OAUTH_SCOPES` variable — the scope string is derived server-side from
> `GOOGLE_DRIVE_FULL_ACCESS`.

---

## 4. Permissions & scopes

| Scope | Sensitivity | Why |
| --- | --- | --- |
| `openid`, `userinfo.email`, `userinfo.profile` | non-sensitive | Identify the connected account (email, name, avatar) for multi-account UX. |
| `.../auth/drive.file` | **non-sensitive** | Create/upload files & folders and manage **only what this app creates**. No Google verification needed. |
| `.../auth/drive` | **restricted** | Full Drive access, incl. browsing **pre-existing** folders. Needs verification + CASA. Off by default. |

**What `drive.file` can and cannot do:** it can create folders, upload into them, list/manage the files
and folders **this app created**, and read your storage quota. It **cannot** browse folders you created
elsewhere (outside Kosh). To organize into an existing arbitrary folder without the restricted scope,
the Google Picker is the intended future path (see §7) — it grants per-file access under `drive.file`.

---

## 5. Required Google APIs & technologies

- **Google Drive API v3** — resumable uploads (`/upload/drive/v3/files?uploadType=resumable`),
  `files.list`/`files.create` (folders + duplicate check), `about.get` (storage quota).
- **Google OAuth 2.0 / OpenID Connect** — auth-code flow with `access_type=offline` for a refresh token;
  token + revoke endpoints; the OpenID `userinfo` endpoint for account identity.
- **Kosh technologies:** `XMLHttpRequest` (upload progress), the resumable chunk protocol, a Zustand
  upload store with a concurrency-3 scheduler, Express + zod routes, and `encryptSecret`/`decryptSecret`
  (AES-256-GCM) for token-at-rest. The web CSP already allows Google origins
  (`connect-src https:`, `img-src https:` for thumbnails), so no CSP change is needed.

---

## 6. Features (built in)

- **Multi-account** — connect several Google accounts, switch between them, disconnect (revokes the
  token on Google).
- **Choose or create folders** — browse app-visible folders with breadcrumbs; create new folders and
  nested structures.
- **Single files or whole folders** — pick files, pick a folder (`webkitdirectory`), or **drag & drop**
  files/folders (the folder tree is recreated in Drive, with folder creation memoized per batch).
- **Browser-direct resumable uploads** — initiate a session, PUT chunks (8 MiB), advance on `308`,
  finalize on `200/201`.
- **Real-time progress** — per-file progress bars plus an aggregate dashboard: completed / failed /
  remaining counts and an overall percentage and byte total.
- **Pause / resume / retry** — pause frees the concurrency slot; resume re-queries the byte offset
  (`bytes */total`) and continues; failed files retry (with exponential backoff on `5xx`/`429`).
- **Concurrency** — up to 3 files upload at once via a queue scheduler.
- **Mid-upload token refresh** — if the access token expires (`401`), a fresh one is minted and the same
  session continues.
- **Duplicate detection** — before uploading, checks the destination folder for same-named files and
  flags them; upload keeps both copies, or skip duplicates with one click.
- **Upload history** — a persistent feed of recent uploads (metadata only) with links into Drive.
- **File previews** — inline image thumbnails for queued images; history links open the file in Drive.
- **Storage usage** — a live quota gauge (handles unlimited-plan accounts).
- **Secure by design** — encrypted refresh token at rest, CSRF-protected signed OAuth `state`,
  short-lived browser tokens only, and a graceful demo/connect gate when Google isn't configured.

---

## 7. Suggested enhancements (professional / enterprise-ready)

These are intentionally **not** built yet; they're the roadmap to an enterprise-grade integration:

- **Google Picker** — let users select **any** existing file/folder under `drive.file` (no scope
  escalation). Requires widening the web CSP `script-src` to `apis.google.com` and
  `VITE_GOOGLE_CLIENT_ID` / `VITE_GOOGLE_API_KEY` / `VITE_GOOGLE_APP_ID`.
- **Resume across page reloads** — persist session URIs in IndexedDB and re-select the file to continue
  (a `File` handle can't survive a reload).
- **Replace-in-place duplicates** — resumable `PATCH /upload/drive/v3/files/<id>` with an optional
  `keepRevisionForever`.
- **Client-computed MD5** — bundle an MD5 lib to dedupe by exact content before uploading.
- **Encrypt-before-upload** — reuse Kosh's `vaultCrypto` (opt-in; disables thumbnails and dedup for
  encrypted objects).
- **Pre-upload DLP** — reuse `@kosh/shared`'s `scanSecrets` on text files, with the same block-with-
  confirm gate as the GitHub publish flow.
- **Folder management extras** — rename/move (`addParents`/`removeParents`), trash/delete.
- **Shared Drives (Team Drives)** — target a `driveId` with `corpora=drive` +
  `includeItemsFromAllDrives` + `supportsAllDrives` on every call.
- **Service account + domain-wide delegation** — admin bulk migration/provisioning for organizations.
- **Change tracking** — Drive push notifications (`files.watch`) + `changes.list` to reconcile history.
- **Governance** — exportable audit logs, labels/retention/DLP, per-folder permission management, org
  MIME/size policy, and per-account quota dashboards.
- **Speed & ETA** — an exponential-moving-average transfer-rate and time-remaining readout.
- **Server-minted resumable sessions** — for locked-down networks where the browser can't read the
  `Location` header.

---

## 8. Using it

1. Open **Google Drive** in the sidebar → **Sign in with Google** (add more accounts any time from the
   account menu).
2. Pick a **destination** folder (or create one). Files upload into the folder you're viewing.
3. **Drag in** files or a folder, or use **Select files** / **Select folder**.
4. Review the queue — duplicates are flagged — then **Upload**. Watch per-file and overall progress;
   **pause/resume/retry/cancel** individual files as needed.
5. Track your **storage usage** and **recent uploads** in the sidebar.

---

## 9. Troubleshooting

- **"Google Drive isn't configured"** — set `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` and restart the API.
- **`redirect_uri_mismatch`** — the console's Authorized redirect URI must equal
  `<API_URL>/api/drive/auth/callback` byte-for-byte (scheme, host, port, path).
- **"needs to be reconnected"** — the refresh token was revoked/expired; disconnect and reconnect.
- **"Google didn't grant offline access"** — remove Kosh under
  <https://myaccount.google.com/permissions> and reconnect (forces a fresh consent with offline access).
- **Access blocked / app not verified** — while the OAuth screen is in **Testing**, add your address as a
  **test user**; a `drive.file` app can be published to Production without a review.
