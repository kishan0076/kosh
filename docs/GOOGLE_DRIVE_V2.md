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

---

## 3. Architecture

- **Management CRUD is server-proxied:** browser → Kosh `/drive-v2` routes → Google Drive API, using a
  short-lived access token minted server-side from your **encrypted refresh token**. The token is never
  returned to the browser for management calls.
- **File bytes upload browser → Google directly** via V1's resumable engine (bytes never touch the API).
- **Optimistic + rollback:** every action updates the UI instantly, then reconciles with Drive's
  authoritative response — or rolls back and shows a retry toast on failure. A sequence guard prevents a
  slow response from clobbering newer navigation.
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
  person's access, toggle "Anyone with the link", and copy the link (`permissions.*`).
- **Drag-and-drop move** — drag files/cards (or a whole selection) onto folders or breadcrumb segments.
- **Virtualized** list and grid — thousands of items scroll smoothly.
- **⌘K command palette** — run actions or search-and-open any file.
- **Insights** — a storage-by-type breakdown, a **duplicate finder** (group by md5, reclaim space),
  **largest files**, and **stale files** (least-recently-opened), backed by a capped Drive scan.
- **Bulk rename** — find/replace + sequential numbering with an extension-preserving live preview.
- **Advanced search operators** — `type:`, `owner:me|<email>`, `before:`/`after:`, `is:starred`, plus
  **saved searches**.
- **Version history** — list and delete prior revisions of a file.
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

- **Real-time two-way sync** — poll `changes.list` from a stored page token, then `changes.watch`
  webhooks (needs new server routes + a callback endpoint).
- **Rubber-band drag-select** and drag-drop **upload into a specific folder** (drop external files onto
  a folder row).
- **Embedded preview** for PDF/Docs/video via an iframe — needs one line added to the web CSP
  (`frame-src https://drive.google.com`); today non-images open in Drive.
- **Restore a specific revision** / download old versions (list + delete are built).
- **Shared Drives** (`driveId`, `corpora=drive`) as first-class spaces — the API already passes
  `supportsAllDrives`, so items in Shared Drives are operable; a dedicated space picker is the addition.

## 6. Infra / enterprise-gated (documented, deliberately not shipped)

These need infrastructure, an admin setup, or a new OAuth scope + re-consent — shipping a half-working
version would be worse than none, so they're documented instead:

- **Drive Activity timeline** — the Drive Activity API is a *separate* API that must be enabled and
  needs the extra `drive.activity.readonly` scope (a re-consent). Straightforward to add once you accept
  that scope prompt.
- **Full governance** — Labels (the **Drive Labels API**, a separate API + admin label taxonomy),
  retention policies, and DLP are Workspace-admin / enterprise features, not user-level API calls.
- **Service account + domain-wide delegation** — an org deployment concern (a service-account key +
  admin console delegation), not something to expose in the per-user UI.
- **Exportable audit logs** — meaningful only alongside the change-tracking/activity work above.

---

## 7. Endpoints (all under `/drive-v2/accounts/:id`, owner-scoped)

Reads: `GET /list?parent=`, `/search` (text/mimeType/mimeContains/owner/before/after/starred),
`/recent`, `/starred`, `/trash`, `/shared`, `/scan?orderBy=&cap=`, `/files/:fileId`, `/path?folder=`,
`/files/:fileId/permissions`, `/files/:fileId/revisions`. Writes: `POST /folders`,
`PATCH /files/:fileId/rename|star|trash|meta`, `POST /files/:fileId/move|copy`, `DELETE /files/:fileId`,
`POST /empty-trash`, `POST|PATCH|DELETE /files/:fileId/permissions[/:permId]`,
`DELETE /files/:fileId/revisions/:revId`. Accounts, config, storage quota and the upload token reuse the
V1 endpoints. Errors use Kosh's typed envelope (`NEEDS_RECONNECT` 400 → the scope gate, `UPSTREAM` 502 → retry).

---

## 8. Notes & limits

- **Google-native files** (Docs/Sheets/Slides) have no size/checksum/direct-download link — V2 shows
  "—" and offers "Open in Drive".
- **File copy** is atomic; **folder copy** is a bounded (500-op) client-side walk.
- **Insights** scans up to 20k files and flags when the result was sampled.
- **Thumbnails** are short-lived and auth-scoped; V2 falls back to a file-type icon if one won't load.
- The only raw hex colors in V2 are Google Drive's own **folder-color palette** (confined to the
  color picker); everything else uses Kosh's semantic design tokens.
