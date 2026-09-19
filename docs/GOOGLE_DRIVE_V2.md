# Google Drive V2 — the control center

Drive V2 is a **separate, premium file-management module** that manages **all** of your Google Drive
from inside Kosh, with every action synced two-way to Drive. It's an independent version — the original
[Google Drive](./GOOGLE_DRIVE.md) module (V1) is untouched and keeps working exactly as before. Both
coexist: **Google Drive** (V1, `/drive`) and **Drive** (V2, `/drive-v2`) in the sidebar.

> **V2 is not a redesign of V1 — it's a different product.** V1 is an *uploader* scoped to files the
> app created (least-privilege `drive.file`). V2 is a *file manager* over your **entire** Drive (full
> `drive` scope), so it can browse, rename, move, copy, star, trash and delete your existing files.

---

## 1. What's new vs V1

| | V1 — Google Drive | V2 — Drive |
| --- | --- | --- |
| Purpose | Upload files/folders into Drive | Full **control center** for all of Drive |
| Sees | Only files this app created | **All** your folders & files |
| Scope | `drive.file` (no verification) | `drive` (restricted — needs verification for external users) |
| Actions | Upload, folder create, dup-check | Browse, create, **rename, move, copy, star, trash, restore, delete**, upload |
| Views | Upload queue + history | My Drive · Recent · Starred · Trash · Search |
| Delete UX | — | **Custom** trash-vs-permanent confirmation modal (never the browser dialog) |

Both modules share the same connected Google accounts and encrypted token store — connect once, use
either. V2 reuses V1's resumable upload engine and account/token endpoints **by import only**.

---

## 2. Prerequisite: full Drive access

To see and manage your **existing** files, V2 needs the restricted `drive` scope. Turn it on:

1. Set on the API server:
   ```dotenv
   GOOGLE_DRIVE_FULL_ACCESS=1
   ```
2. Restart the API, open **Drive** in the sidebar, and **reconnect** your Google account (a token
   granted under the old `drive.file` scope can't be upgraded — you must re-consent).

Until both are true, V2 shows a **scope gate** explaining exactly what to do — it never shows an empty
grid. Two independent signals are checked: the server flag (`config.fullAccess`) **and** the selected
account's granted scope (exact-token match on `…/auth/drive`).

> **Production note:** the `drive` scope is a Google **restricted** scope. Before people outside your
> test users can grant it, Google requires OAuth verification + a CASA security assessment. Plan for
> this early; in **Testing** mode your own test-user account works immediately.

### Optional: near-instant push sync (`changes.watch`)

Sync works out of the box via polling. To upgrade it to **push** (Google notifies the server the instant
anything changes), set on the API:

```dotenv
DRIVE_WEBHOOK_URL=https://<your-public-api-host>/api/drive-v2/webhook/changes
```

- The URL must be **publicly reachable over HTTPS** (Google POSTs to it) and its domain **verified** for
  your app (Google Search Console / the Cloud console domain-verification list) — Google refuses to
  register a channel on an unverified domain.
- Leave it unset (e.g. localhost, or a host Google can't reach) and V2 silently uses the polling sync —
  no degraded UI, no errors.
- Push is **single-instance**: the channel registry and SSE sockets live in the API process. A
  multi-instance deployment needs a shared registry + pub/sub (documented in §6, not built).

---

## 3. Architecture

- **Management CRUD is server-proxied:** browser → Kosh `/drive-v2` routes → Google Drive API, using a
  short-lived access token minted server-side from your **encrypted refresh token**. The token is never
  returned to the browser for management calls.
- **File bytes upload browser → Google directly** via V1's resumable engine (bytes never touch the API).
- **Optimistic + rollback:** every action updates the UI instantly, then reconciles with Drive's
  authoritative response — or rolls back and shows a retry toast on failure. A sequence guard prevents a
  slow response from clobbering newer navigation.
- **Push sync path (when enabled):** the server opens one `changes.watch` channel per active account
  (user corpus, `includeItemsFromAllDrives` → also covers Shared Drives). Google POSTs a headers-only
  ping → the server validates the per-channel token, polls `changes.list`, and fans the changes out to
  that account's open browser tabs over **Server-Sent Events**. Channels auto-renew before their ~6h TTL
  and are stopped (`channels.stop`) when the last tab leaves. The browser's poller idles while the SSE
  stream is healthy and takes over instantly if it drops. A generation guard discards any in-flight poll
  or SSE frame after an account/space switch.
- **New files only (V1 untouched):** `integrations/googleDriveV2.ts`, `routes/driveV2.ts`,
  `data/driveV2Api.ts`, `data/driveV2.ts`, `pages/DriveV2.tsx`, `components/drive-v2/*`. The only shared
  edits are additive: the router mount, a `/drive-v2` rate limit, the route, and the sidebar entry.

---

## 4. Features (built in)

- **All your Drive** — browse folders and files with nested navigation and breadcrumbs (deep links
  hydrate the breadcrumb from the server).
- **Views** — My Drive, Recent, Starred, Trash, and full-text **Search** (debounced).
- **Grid & list** layouts (remembered), client-side **sort** (name/modified/size/type, folders first)
  and **filter** by kind (folders/docs/images/video/PDF/audio/archives).
- **Full CRUD, synced to Drive** — create folder, **rename** (inline), **move** (folder picker),
  **copy** (files), **star/unstar**, **trash & restore**, and **permanent delete**.
- **Multi-select + bulk actions** — click / shift-range / ctrl-toggle, a selection action bar, and
  bulk move/trash/restore/delete/star run at bounded concurrency with per-item success/failure.
- **Right-click context menu** and hover quick-actions, capability-aware (actions Drive says you can't
  perform are hidden/disabled to avoid errors).
- **Details drawer** — thumbnail, type, size, owner, dates, checksum, **editable notes** (persisted to
  the file's Drive description), a sharing summary, and quick actions.
- **Sharing & permissions** — a Share modal: add people by email with a role, change/remove each
  person's access (domain grants and non-assignable roles shown read-only), toggle "Anyone with the
  link", and copy the link (`permissions.*`).
- **Embedded preview** — PDFs, videos, and Google Docs/Sheets/Slides open **inline** in a full-screen
  viewer (Drive's own embed via a scoped CSP `frame-src`); images render directly; anything else offers
  "Open in Drive".
- **Live two-way sync** — external edits, new files and deletions appear automatically. When the server
  is configured with a public webhook URL it uses **`changes.watch` push** (Google pings the server →
  the server relays over **SSE** → near-instant); otherwise it falls back to a **`changes.list` poller**
  (every ~12s, paused when the tab is hidden). A toolbar **sync pill** shows live / syncing / error and,
  for polling, "synced N ago"; if the push stream drops, the poller seamlessly covers the gap.
- **Activity timeline** — every change (created / edited / trashed / removed), in Kosh or elsewhere in
  Drive, streams into an Activity panel while the tab is open, with **CSV export** (a lightweight audit
  log).
- **Shared Drives (spaces)** — a space picker switches between **My Drive** and each Shared Drive; browse,
  search, recent, starred and trash are all scoped to the selected drive (`corpora=drive` + `driveId`).
- **Drag-and-drop move** — drag files/cards (or a whole selection) onto folders or breadcrumb segments.
- **Rubber-band select** — click-drag an empty area to marquee-select the visible items (hold ⇧/⌘ to add).
- **Virtualized** list and grid — thousands of items scroll smoothly.
- **⌘K command palette** — run actions or search-and-open any file.
- **Insights** — a storage-by-type breakdown, a **duplicate finder** (group by md5, reclaim space),
  **largest files**, and **stale files** (least-recently-opened), backed by a capped Drive scan.
- **Bulk rename** — find/replace + sequential numbering with an extension-preserving live preview.
- **Advanced search operators** — `type:`, `owner:me|<email>`, `before:`/`after:`, `is:starred`, plus
  **saved searches**.
- **Version history** — list prior revisions, **download** any version, **keep-forever** (pin) a
  version so Drive won't auto-prune it, and delete old ones.
- **Shared with me** — a dedicated view of files others shared with you.
- **Recursive folder copy** — "Make a copy" on a folder walks and recreates the whole tree.
- **Custom Create-folder modal** — name validation, live duplicate hint, and optional folder **color**
  and **description**.
- **Custom Delete-confirmation modal** — clear trash-vs-permanent modes, item info and consequences, an
  **Undo** toast for trashing, and **type-to-confirm** for permanent deletion. The browser's default
  confirm dialog is never used.
- **Upload** — drag-and-drop or pick files into the current folder (reuses the resumable engine), with a
  live upload tray.
- **Storage meter**, image **preview** overlay (opens other types in Drive), skeleton loaders, and
  per-view empty and error states with retry.
- **Keyboard-friendly** — ⌘/Ctrl+A select all, Esc clear, Delete to trash, F2 rename.

---

## 5. Still on the roadmap (feasible)

Realistic with the current scope; not built yet:

- **Drag-drop upload into a specific folder** — drop external files directly onto a folder row (today
  they upload into the current folder).
- **In-place revision restore** — promote an old revision to "current" without the download-then-reupload
  round-trip (the API has no direct "make revision X the head" call for binary files, so this means
  re-uploading the chosen revision's bytes).

## 6. Enterprise / admin-gated (documented, deliberately NOT shipped)

These are **not** per-user Drive API features — a per-user OAuth token cannot perform them. They require
a Google Workspace **admin console**, a separate enterprise API + an admin-defined taxonomy, or a new
OAuth scope with re-consent. Shipping fake UI that only *looked* like it applied them would be worse than
not shipping — so they're documented here with exactly what each one needs, and left out.

- **Drive Activity API timeline** — the in-app Activity panel (§4) is built from the **changes feed** on
  the existing scope. A richer, actor-attributed timeline ("Alex commented", "Sam moved") needs the
  *separate* **Drive Activity API** enabled **and** the extra `drive.activity.readonly` scope (a
  re-consent). Additive once you accept that scope prompt; not shipped to avoid a silent scope upgrade.
- **Labels / retention / DLP** — Labels are the **Drive Labels API** (a separate API **plus** an
  admin-published label taxonomy); retention and DLP are **Workspace-admin / Vault** policies. None are
  user-level calls — a personal OAuth token has nothing to apply, so there is no honest per-user UI to
  build.
- **Service account + domain-wide delegation** — an org deployment concern (a service-account key +
  admin-console delegation), never something to expose in a per-user UI.
- **Exportable audit logs (org-wide)** — the built Activity panel exports the *current session's*
  observed changes as CSV. A tamper-evident, org-wide audit export is a Workspace-admin / Vault feature,
  not a user-token capability.

---

## 7. Endpoints (all under `/drive-v2/accounts/:id`, owner-scoped)

Reads: `GET /list?parent=`, `/search` (text/mimeType/mimeContains/owner/before/after/starred),
`/recent`, `/starred`, `/trash`, `/shared`, `/scan?orderBy=&cap=`, `/files/:fileId`, `/path?folder=`,
`/files/:fileId/permissions`, `/files/:fileId/revisions`, `/drives` (Shared Drives),
`/changes/start` + `/changes?pageToken=` (poll sync), `/events` (SSE push stream). All list/search/view
reads accept an optional `?driveId=` to scope to a Shared Drive. **Unauthenticated:**
`POST /drive-v2/webhook/changes` is Google's `changes.watch` callback (validated by the per-channel
`X-Goog-Channel-Token`, never a session). Writes: `POST /folders`,
`PATCH /files/:fileId/rename|star|trash|meta`, `POST /files/:fileId/move|copy`, `DELETE /files/:fileId`,
`POST /empty-trash`, `POST|PATCH|DELETE /files/:fileId/permissions[/:permId]`,
`PATCH /files/:fileId/revisions/:revId` (keep-forever) + `DELETE /files/:fileId/revisions/:revId`.
Accounts, config, storage quota and the upload token reuse the V1 endpoints. Revision **bytes** download
browser→Google directly with a short-lived token (never proxied). Errors use Kosh's typed envelope
(`NEEDS_RECONNECT` 400 → the scope gate, `FORBIDDEN` 403 → per-item permission, `DRIVE_BAD_REQUEST` 400,
`UPSTREAM` 502 → retry).

---

## 8. Notes & limits

- **Google-native files** (Docs/Sheets/Slides) have no size/checksum/direct-download link — V2 shows
  "—" and offers "Open in Drive".
- **File copy** is atomic; **folder copy** is a bounded (500-op) client-side walk.
- **Insights** scans up to 20k files and flags when the result was sampled.
- **Live sync** is push (`changes.watch` → SSE) when `DRIVE_WEBHOOK_URL` is set, else a ~12s poll that
  pauses when the tab is hidden; either way it re-anchors its page token when you switch account or
  Shared Drive, and the poller catches up automatically if the push stream drops. Push channels are
  in-memory (single-instance) and auto-renew before their ~6h TTL. The Activity timeline lives only in
  the open tab (it is not persisted server-side) and is capped at 200 recent entries.
- **Embedded preview** requires `frame-src https://drive.google.com https://docs.google.com` in the web
  CSP (`apps/web/public/_headers`); the iframe is sandboxed. It reflects Drive's own sharing — a file you
  can't view in Drive won't render in the embed.
- **Thumbnails** are short-lived and auth-scoped; V2 falls back to a file-type icon if one won't load.
- The only raw hex colors in V2 are Google Drive's own **folder-color palette** (confined to the
  color picker); everything else uses Kosh's semantic design tokens.
