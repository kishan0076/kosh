# Drive V2 — Production-Readiness Review & Roadmap

A deep review of the Drive V2 file-manager module (`apps/web/src/{pages/DriveV2.tsx,data/driveV2*.ts,components/drive-v2/*}`,
`apps/api/src/{integrations/googleDriveV2.ts,integrations/driveV2Push.ts,routes/driveV2.ts}`) for reliability,
performance, UI/UX, and API/loading behaviour — plus a roadmap of powerful new features benchmarked against
modern cloud-storage tools (Google Drive web, Dropbox/Dash, OneDrive, Box, macOS Finder, Notion, Linear, Raycast, Arc).

Method: a multi-agent review — six finder dimensions (store correctness, server correctness, sync reliability,
performance, UX/usability, API/loading) with **per-finding adversarial verification**, plus a modern-tool research
track and a completeness critic. 85 candidate findings; **9 were refuted** on verification and dropped; the survivors
below were cross-checked against a direct reading of the store, page, item components, and server integration.

---

## 0. Verdict

Drive V2 is genuinely impressive and unusually feature-complete for a self-built module: full CRUD synced to
Drive, optimistic UI with rollback and sequence guards, virtualized grid/list, push (`changes.watch`→SSE) sync
with a polling fallback, Shared Drives, insights/duplicate-finder, version history, sharing, marquee-select, a
command palette. The architecture (server-proxied management, browser→Google byte transfer, module-level sync
controller) is sound.

The gap between "impressive" and "production-grade" is now concentrated in five areas:

1. **Data-safety** — the single most destructive action (Empty Trash) has *no* confirmation, and bulk permanent
   delete skips the type-to-confirm guard that single delete requires.
2. **Accessibility & mobile** — the file grid is completely keyboard-inoperable, and on touch/phones the core
   controls are hover-only and the layout buries the file list below a full-width rail.
3. **Correctness at scale** — sort, filter, and select-all only see the *loaded page*, so they silently produce
   wrong results (and dangerous partial deletes) in any paginated folder.
4. **Silent failure modes in sync** — several paths keep reporting "Live" while delivering nothing.
5. **Reliability hygiene** — no error boundary, no retries/timeouts, per-request token re-minting, and zero tests
   on the highest-risk store logic (which also violates the repo's own "validate with shared logic + tests" rule).

None of these are architectural rewrites — they're a focused hardening pass. Priorities below are tiered P0→P2.

---

## 1. P0 — Fix first (data-safety, correctness, broken-for-a-user-segment)

### 1.1 Empty Trash permanently deletes everything with zero confirmation — **data-loss**
`PageHeader.tsx:70` → `driveV2.ts:992` calls `emptyTrash()` straight to the API. It irreversibly deletes every
trashed file in Drive, yet it's the only destructive action with *no* dialog. Route it through a confirmation modal
that states count + total size and requires an explicit (ideally type-to-confirm) action, matching `DeleteConfirmModal`.

### 1.2 Bulk permanent delete skips the type-to-confirm guard — **data-loss**
`modals.tsx:146`: `requireType = permanent && targets.length === 1`. Deleting *one* file forever demands typing its
name; selecting 50 and "Delete forever" needs a single click. Invert the logic — require confirmation *more* as the
blast radius grows (type the count, or "DELETE").

### 1.3 Sort / Filter / Select-all only see the loaded page — **correctness + destructive-subset risk**
`visible` sorts+filters `nodes` in memory (`DriveV2.tsx:163-166`) but folders paginate via manual "Load more"
(`DriveV2.tsx:267`). Consequences:
- Filtering to "Videos" inspects only page 1 → a folder whose videos are on page 5 shows **"This folder is empty."**
- Sort by size/date orders only what's loaded, so "largest" is wrong until every page is fetched.
- `Cmd-A` / Select-all selects only `orderedIds` (loaded page) **while the toggle reads "all selected"**
  (`DriveV2.tsx:400`). A user who "selects all → Trash" in a 900-item folder silently hits ~100. (Extra critic finding.)

Fix: push sort/filter to the Drive query (`orderBy` + `q`/`mimeType`) and refetch from page 1 on change; or eagerly
load all pages before a client filter. At minimum, when a filter/select-all is active with `nextPageToken` present,
signal "showing N of many — load all" and gate destructive bulk actions accordingly.

### 1.4 File grid/list is completely keyboard-inoperable — **accessibility**
Every `FileRow` (`items.tsx:190`) and `FileCard` (`items.tsx:247`) is `tabIndex={-1}`; there is no arrow-key
navigation and the container keydown only does Ctrl+A/Delete/F2/Esc (`DriveV2.tsx:221`) — which itself only fires
once some descendant has focus. Items are `<div>`s with no `role` and no Enter/Space activation. Implement a
**roving-tabindex grid**: one item tabbable at a time, arrows move focus (respecting columns), Enter opens, Space
toggles selection, Shift+Arrow extends; add `role="grid"/"row"/"gridcell"` (or a listbox pattern).

### 1.5 Touch/mobile is a second-class experience — **usability**
- Select disc, star, and the overflow (kebab) menu are hover-only (`items.tsx:164/215/230/290/300`) → invisible on
  touch. Long-press → multi-select, and always-render a kebab at reduced opacity on coarse pointers.
- The rail stacks full-width **above** the list below `lg` (`DriveV2.tsx:234`, `DriveRail.tsx:117`): account crest,
  New button, all nav, storage meter — so a phone user scrolls past the whole rail to reach any file. Collapse the
  rail into a top app-bar/drawer on mobile and let the list own the viewport.
- No right-click alternative on touch → a bottom-sheet action menu.

### 1.6 Uploads into a Shared Drive fail — **bug**
`uploadFiles` targets `currentFolderId(path, spaceId)` (`driveV2.ts:1017`), which at a Shared Drive root is the
drive id, but the resumable init URL (`driveApi.ts:89`) omits `supportsAllDrives=true`, so the create is rejected.
Add `supportsAllDrives=true` to the upload-init (and any resumable session URL), matching the download path.

### 1.7 Silent sync death — the UI says "Live" while nothing arrives — **reliability**
Three independent paths make sync die quietly:
- **Watch-channel creation failure is invisible.** `/events` emits `ready`, then `await ensureWatch(...).catch(()=>{})`
  (`routes/driveV2.ts:236`). If the watch can't be created (unverified webhook domain, token error, transient 5xx),
  the SSE socket stays open, the client's `onopen` sets `via:"push"`, and the poller idles → effective latency ~60s
  with a green "Live" pill. Report watch success/failure to the client (`{type:"push-unavailable"}`) and only claim
  push after a real subscription.
- **Expired changes page-token (Google 410) is misclassified as a transient 502** (`googleDriveV2.ts:79`): 410/404
  fall through to `GoogleTransientError`, so the poller retries a permanently-dead token forever and sync silently
  stops. Special-case 410/404 as "re-anchor".
- **The push hub's page token is poisoned permanently** after a 410: `pollAndBroadcast` catches the error and returns
  *without* resetting `ch.pageToken` (`driveV2Push.ts:243`), and channel renewal reuses it — so a channel can live
  for hours delivering nothing. Reset the token on 400/404/410 and re-anchor.

### 1.8 No React error boundary anywhere — **resilience**
No `ErrorBoundary`/`componentDidCatch` in the app; the route mounts `<DriveV2 />` bare (`main.tsx:50`). A single
render throw — e.g. from a malformed node folded in by live-sync — white-screens the whole module with no recovery.
Wrap the module (ideally the app) in an error boundary with an inline "reload this folder / back to My Drive" card.

---

## 2. P1 — Reliability & production hardening

### 2.1 Server re-mints an OAuth token on every request (and writes the DB) — **perf/reliability**
`tokenFor()` calls `refreshAccessToken()` per request and discards `expiresIn`, plus writes `lastUsedAt` every call
(`routes/driveV2.ts:76`); the push hub does the same per webhook ping and per renewal (`driveV2Push.ts:52`). Cache
the minted token per account in memory until `expiresIn − ~60s`, shared by the route and push paths, and throttle the
`lastUsedAt` write. This removes a Google round-trip + a DB write from the hot path of every list/search/poll.

### 2.2 Loads blank the grid to a full skeleton — **loading UX**
`load()` sets `listLoading:true` on every non-cache path (`driveV2.ts:289`) and the content area shows a
full-replacement skeleton whenever it's true (`DriveV2.tsx:639`). Because many flows call `load(true)` — time-sensitive
`setView`, overlay close, restore/undo, upload completion, and the **60s SSE-idle reconcile** — the grid you're
looking at flashes empty and loses scroll/loaded-pages. Adopt **stale-while-revalidate**: keep current nodes visible
and show a thin top "refreshing" bar; only show the full skeleton when `nodes` is empty.

### 2.3 No retries, no timeouts, swallowed errors — **reliability**
- `v2req` does a single fetch with no retry (`driveV2Api.ts:5`). The server deliberately maps Drive throttling
  (403 rate-limit / 429) to `UPSTREAM 502` expecting a client retry — but there is none, so transient blips surface as
  hard errors. Add bounded retry+backoff (honouring `Retry-After`) for idempotent reads and 429/502.
- No fetch timeout anywhere (client `driveV2Api.ts` and server `driveFetch` `googleDriveV2.ts:121`). A stalled socket
  leaves the skeleton spinning forever and, on the server, ties up the Express handler / SSE socket. Add
  `AbortController` deadlines.
- `loadMore` swallows failures (`driveV2.ts:723`): spinner stops, no toast, no retry — looks like "end of list."
  Surface an error + retry.
- `NEEDS_RECONNECT` is preserved as a code by `v2req` but flattened to a message string everywhere (`driveV2.ts:308`),
  so a scope-lost 401 shows a generic toast instead of a Reconnect action. Detect the code and offer reconnect.

### 2.4 Optimistic rollback is too broad — **correctness (transient)**
`mutate()` snapshots the *entire* `nodes` array and, on failure, restores it wholesale (`driveV2.ts:319/332`).
Optimistic actions don't bump `loadSeq`, so two overlapping mutations on different nodes — or a live-sync batch
folded in mid-flight (`applyChanges`, `driveV2.ts:380`) — get clobbered by the failing one's rollback (a just-synced
new file, or another item's star, vanishes until the next refetch). Roll back **id-scoped** (restore only the affected
ids), or bump a generation in `applyChanges`. Self-heals on navigation today, but it's a visible glitch.

### 2.5 SSE churn on tab refocus — **reliability**
`onVis → startSync → openEventSource` unconditionally closes and rebuilds the SSE channel on every refocus
(`DriveV2.tsx:143`, `driveV2.ts:626/475`), each time re-minting a token and opening a new Drive watch. Skip the
rebuild when a healthy stream already exists.

### 2.6 Cache-invalidation storm — **perf**
`applyChanges` calls `invalidateFolderViews()` (drops *all* My-Drive folder caches) after *every* change batch
(`driveV2.ts:416`). On an actively-changing Drive the 30s folder cache is effectively defeated. Invalidate only the
folders whose parents actually appear in the batch.

### 2.7 Server-side pagination gaps — **correctness**
`listPermissions` (pageSize 100) and `listRevisions` (pageSize 200) never loop `nextPageToken`
(`googleDriveV2.ts:514/391`) — a file shared with >100 people, or with >200 revisions, silently truncates. Loop the
token. `emptyTrash`/`listTrash` also ignore `driveId` (`googleDriveV2.ts:478/372`), so on a Shared Drive "empty trash"
targets the wrong corpus — thread `driveId` + `supportsAllDrives`.

### 2.8 Breadcrumb hydration is a serial walk — **perf**
`folderPath` walks up `parents` one `getFile` at a time, up to 50 sequential round-trips (`googleDriveV2.ts:558`).
Deep deep-links hydrate slowly. Cache resolved ancestors and/or parallelize.

### 2.9 Recursive folder copy is a fragile client walk — **reliability**
`copyFolder` drives up to 500 fully-sequential list/create/copy calls from the browser (`driveV2.ts:934`); it aborts
the whole tree on one uncopyable child, drops folder color/description/starred, and copies into the folder captured at
call start even if the user navigated away. Add a server-side recursive-copy endpoint (batched, per-item results,
metadata-preserving), or at least make the client walk resilient with a summary.

### 2.10 Downloads rely on the Google web session, not the OAuth token — **correctness**
Context-menu "Download" and the drawer use `window.open(node.webContentLink)` (`DriveV2.tsx:351`), which only works
if the user is separately signed into Google in that browser; it breaks for OAuth-only users, and native Docs have no
download path at all. Download via the OAuth token (as `downloadRevision` already does) and add `files.export` for
native docs.

### 2.11 No tests on the highest-risk logic — **repo-rule violation**
`CLAUDE.md`'s golden rule is "validate with shared logic + add tests," yet the V2 store is untested and its pure
domain logic (`parseSearch`, `sortNodes`, `dedupeActivity`, the `applyChanges` reducer, `mutate`/`bulk` rollback)
lives in the store, not `@kosh/shared`. Extract the pure functions to `@kosh/shared` and unit-test them; they encode
exactly the change-fold/rollback behaviour that keeps regressing.

### 2.12 Observability & security hygiene
- No metrics/health surface for the push hub or client errors (`driveV2Push.ts:134`) — silently-dead sync is
  invisible in prod. Emit live-channel count, renew/poll outcomes, and wire client error monitoring.
- A full-`drive`-scope access token is exposed to browser JS for the upload/download path (`driveApi.ts:75`) — an XSS
  or dependency compromise gets full-Drive blast radius. Document the trade-off; consider a narrower upload path or
  short-TTL scoped tokens where feasible.
- Writes carry no `ETag`/`If-Match` (`googleDriveV2.ts:427`): notes/rename/move are last-write-wins against changes
  the live sync surfaces at the same moment. Add a "changed elsewhere" guard for the notes editor at least.
- Client bulk ops fan out one request per item at concurrency 4 with no `Retry-After` handling and can trip the
  server's own 240/min limiter → self-inflicted 429 partial failures (`driveV2.ts:1100`). A shared request governor
  (below) fixes this.

---

## 3. Performance

Real, verified hot-paths (all confirmed against the code):

- **`applyChanges` is O(changes × nodes)** with a full-array allocation per change (`driveV2.ts:392`) — build one
  `Map<id,index>`, apply all changes into a single working copy, emit one new array.
- **Upload progress re-renders the whole Shell + every visible row.** Shell subscribes to the entire `uploads` array
  but only uses `uploads.length > 0` (`DriveV2.tsx:129/321`); each XHR `onProgress` writes the array → the grid
  re-renders many times/sec during upload. Subscribe to a derived `hasUploads` boolean; isolate progress in the tray.
- **`FileRow`/`FileCard` aren't memoized** (`items.tsx:186/242`) and get freshly-built `handlers`/`rowProps` every
  render (`DriveV2.tsx:181/622`), so every visible item re-renders on each sync tick and selection change. `React.memo`
  + stable callbacks (`useCallback`, a stable handlers object).
- **`sortNodes` re-sorts all loaded nodes with per-comparison `localeCompare`** on every `nodes`/`prefs` change
  (`items.tsx:17`) — precompute a sort key, or a stable collator, and avoid re-sorting on unrelated updates.
- **Marquee select re-queries the DOM and measures every rendered row on every `mousemove`** (`DriveV2.tsx:573`) —
  cache rects at drag start / rAF-throttle.
- **Details `totalBytes` is O(selection × nodes) inline on every Shell render** (`DriveV2.tsx:305`) — memoize with an
  id→size map.
- **Transport:** every read sends `Content-Type: application/json` on GETs → an unnecessary CORS preflight, with no
  `Access-Control-Max-Age` to amortize (`driveV2Api.ts:8`). Drop the header on GETs and cache preflights server-side.
- **`folderCache` has no size bound/LRU** (`driveV2.ts:174`) — grows unbounded in long browsing sessions; add an LRU cap.

---

## 4. UI/UX polish

**Navigation & selection**
- Details inspector opens as a **modal with a scrim on every single file click** (`DriveV2.tsx:199/282`), so browsing
  file-by-file is a click-scrim-click loop. On `lg+`, dock it as a non-modal third column; keep the drawer only on
  narrow screens. (Also: it never opens for folders.)
- **Move has no Undo** (`driveV2.ts:919`) though Trash does — and drag-drop move is the easiest action to misfire.
  Add an Undo toast (restore old parents). Extend Undo to star/rename too.
- Modals and the drawer **don't trap or restore focus** (`overlays.tsx:274`) — add focus trap + return.
- Breadcrumbs only scroll with a hidden scrollbar (`PageHeader.tsx:90`) — collapse deep paths into a "…" menu.
- No right-click menu on empty canvas; no "New" create-menu for Google Docs/Sheets/Slides.

**Upload & bulk**
- Upload tray has no per-file cancel/pause/retry and no dismiss (`DriveV2.tsx:713`) even though the store already
  holds `ResumableControl` — wire the controls.
- External-file drop only works in My Drive (`DriveV2.tsx:621`); other views ignore the drop silently. And uploads
  from Recent/Starred/Search land in root, not where the user is (`driveV2.ts:1017`) — target the last real folder or
  disable with a hint.
- Bulk rename and duplicate-cleanup run sequentially with only a spinner, and "Trash all extras" fires with no confirm
  and keeps an arbitrary "first" copy (`BulkRenameModal.tsx:45`, `InsightsPanel.tsx:247`) — add progress + a
  keep-which choice + confirm.
- Move picker can't create a folder inline, has no search, and lets you pick an invalid descendant destination
  (`modals.tsx:218`).

**Sharing**
- Link sharing is a bare reader on/off toggle (`ShareModal.tsx:91`) while adding a person defaults to **Editor** —
  add role choice (Viewer/Commenter/Editor) + expiry, and make the default least-privilege.

**Visual & motion**
- Selection inserts a `SelectionBar` band that shifts the whole list down (`DriveV2.tsx:252`) — swap the toolbar
  in place instead. Add a multi-item drag ghost with a count badge, spring-loaded folders, and edge auto-scroll.
- A density control (comfortable/compact), aspect-aware thumbnails with a legibility scrim, layout-accurate skeletons,
  and a subtle staggered reveal (the `.reveal-in` keyframe already exists) would lift perceived quality — all with
  existing tokens and `motion-safe:`.

**First-run & platform**
- No onboarding — add a dismissible welcome + power-feature tips. `⌘K` is hardcoded in copy (`DriveV2.tsx:453`) — show
  platform-aware glyphs and a `?` shortcuts sheet.

---

## 5. New & advanced features (roadmap)

Benchmarked against modern tools; effort tags S/M/L. All feasible with the per-user Drive OAuth token unless flagged.

**Organization (highest leverage)**
- **Tags / labels via Drive `appProperties`** (M) — colored, cross-cutting tags on any file, filterable and shown as
  chips. App-private metadata, no extra scope. *(Finder tags, Dropbox tags.)*
- **Smart Collections / saved smart views** (M) — rule-based virtual folders (kind + age + owner + shared + size +
  name/appProperty). Promote today's localStorage saved searches to Drive-synced. *(Finder Smart Folders, Notion.)*
- **Pinned folders / Quick Access** in the rail (M). *(Dropbox Quick Access.)*
- **Drive shortcuts** (`…google-apps.shortcut`) to place one file in many folders (M) — also fixes the current
  shortcut misclassification (`shortcutDetails` is fetched but unused).
- **Group-by / "Arrange by"** sticky sections (kind/date/owner) (M); **configurable list columns** (M);
  **resume-session** (last space/folder/view/scroll) (S).

**Bulk & files**
- **Bulk / whole-folder download as ZIP** (L) and **Export/convert native Docs** via `files.export` (PDF/DOCX/XLSX/MD) (M).
- **Copy-to…** + a searchable folder picker with inline "New folder" (M); **folder upload** with conflict resolution
  (keep both / replace / skip) (M); **infinite scroll** replacing "Load more" (S, list is already virtualized).
- **Server-side batch endpoint** for bulk trash/restore/delete/star/move (M) — one call, avoids the self-inflicted 429.

**Keyboard & power-user**
- **Roving focus + arrow navigation + Space-to-peek Quick Look** (M) — also closes the a11y gap in §1.4.
- **Keyboard-first palette that acts on the selection** (Move/Share/Trash/Star/Export), `j/k`, `?` cheat sheet (M);
  go-to-folder + recent locations in `⌘K`; breadcrumb dropdowns (S). *(Raycast, Linear, Superhuman.)*
- **Type-ahead jump** in grid/list (S).

**Preview**
- **Deep Quick Look** (M) — native text/markdown/code/CSV/audio rendering, zoom/rotate, filmstrip prev/next paging,
  spacebar trigger, inline actions. *(macOS Quick Look, Dropbox preview.)*
- Richer details drawer: file **location** (real parent breadcrumb, "reveal in place"), folder stats, hover peek card.

**Reliability / safety features**
- **Universal Undo** for move/star/delete (S); **data-safety net** — per-item trash auto-purge countdown,
  restore-entire-tree, pre-purge manifest (M); **bulletproof uploads** — resume-after-reload (IndexedDB session URIs),
  retry/backoff, verify (M); **crash-safe shell** + **sync-health panel** (S/M); a shared **client request governor**
  with `Retry-After` awareness (M).

**Collaboration**
- **Link-share power controls** (role/expiry/disable download) (M); **inline Drive comments** (read/reply/resolve) in
  the drawer/preview (M); **folder/saved-search watchers** with notifications (M); **file-request/upload links** to
  collect files from people without Drive access (L).

**AI (leverage existing plumbing)**
- **Natural-language / semantic search** (L); **AI summaries + auto-tagging** in the drawer, written to `appProperties`
  (M); **AI cleanup wizard** — near-dupes, empty folders, stale/large, one-tap reclaim (M). *(Dropbox Dash, Box AI, Google "Organize".)*

**Offline & cross-account**
- **Offline read cache** of last-viewed folders (L); **cross-account / cross-space transfer** (copy/move between
  connected accounts and Shared Drives) (L); background-change desktop notifications + tab-title badge (S).

---

## 6. Suggested execution order

**Implementation status:** Phases A, B, C, D, E, F — ✅ **shipped**, plus the **AI slice** (summaries + auto-tag,
natural-language search, cleanup wizard). Still deferred: a true embedding/vector semantic index, offline read
cache, cross-account transfer, file-request links (each shipped item: implement → verify typecheck/test/build →
code-review → fix findings → commit).

**Phase E:** tags/labels (Drive `appProperties`), smart collections (named saved searches), keyboard
palette-on-selection + `?` cheat sheet + vim `j/k`, and the **IO slice** — OAuth-token downloads (fixes
`window.open(webContentLink)`, §2.10), native-Doc **export** (`files.export`: PDF/Word/Markdown/Excel/CSV/
PowerPoint/…), client-side **bulk ZIP** download (dependency-free STORE-method writer), and a **deep Quick
Look** (filmstrip paging, image zoom/rotate, native markdown/CSV/code rendering). Bytes flow browser→Google
directly with a minted token — nothing proxies through the API. **Still deferred:** whole-folder-tree ZIP
(needs a recursive walk); cross-Drive server-side tag search (needs per-key `appProperties` storage — tag
filtering currently scopes to the loaded view).

- **Phase A — Safety & correctness (P0):** ✅ **shipped.** Empty-Trash confirm, bulk-delete type-to-confirm,
  sort/filter/select-all page-scope, Shared-Drive upload fix, silent-sync-death cluster, error boundary.
  *(Small, high-trust wins.)*
- **Phase B — A11y & mobile:** ✅ **shipped.** roving-focus keyboard grid, touch controls, responsive
  rail/bottom-sheet. *(Unlocks a whole user segment; pairs with the keyboard power-mode feature.)*
- **Phase C — Reliability hardening:** ✅ **shipped.** server token cache (2.1), stale-while-revalidate loads (2.2),
  retries/timeouts/error surfacing + reconnect gate (2.3), id-scoped rollback (2.4), SSE refocus (2.5) +
  targeted cache-invalidation (2.6), pagination loops + Shared-Drive trash scoping (2.7), extracted + unit-tested
  `@kosh/shared` pure logic (2.11). Deferred to a later pass: §2.8 breadcrumb walk, §2.9 server recursive-copy,
  §2.10 OAuth downloads, §2.12 observability/ETag.
- **Phase D — Perf + UX polish:** memoization + upload-render isolation + marquee/sort perf; non-modal docked
  inspector, Move undo, focus trap, density control, drag ghost.
- **Phase E — Power features wave 1:** tags/labels, smart collections, bulk download/export, Quick Look upgrade,
  keyboard palette-on-selection.
- **Phase F — Collaboration & notifications:** ✅ **shipped.** **F1** link-share power controls — per-grant
  expiry (`expirationTime` + `removeExpiration`, My-Drive user/group grants only), anyone-with-link role picker,
  disable-download for viewers/commenters (`copyRequiresWriterPermission`), least-privilege Viewer defaults; the
  eligibility rule lives in `@kosh/shared` `canGrantExpiry` (tested) and is enforced server-side. **F2**
  background-change notifications — a hidden-tab unread counter (from SSE push *and* the slower hidden-tab poll),
  a `(N)` tab-title badge cleared on refocus, and an opt-in, permission-gated desktop notification that focuses
  the tab on click. **F3** inline Drive comments — read/compose/reply plus resolve/reopen (Drive's reply
  `action`) in the details inspector, rendering plain-text `content` only (never `htmlContent`).
- **AI slice — ✅ shipped** (built on the Sprint-6 Anthropic client + per-user daily spend cap; gated on an `ai`
  config flag). Foundation: exported budget-capped primitives in `claude.ts` (`completeText`, `extractJson`,
  `ensureAiBudget`/`reserveBudget`/`refundBudget`, serialized per user), server `fetchFileTextServer` (export
  native docs / read text binaries, byte-capped) + shared tested `driveTextSource`. **Summaries + auto-tag:**
  `/files/:id/summarize` → an inspector "AI" section (summary via `<Markdown>`, append-to-notes, dashed
  suggested-tag chips). **Natural-language search:** `/ai-search` → the LLM emits the app's own Drive operator
  DSL (parsed/tested by `parseDriveSearch`), run through the normal search path with the executed query
  decoupled from the displayed text + an interpretation chip; timezone-correct via a client-supplied date.
  **Cleanup wizard:** shared tested `computeCleanupBuckets` (duplicates/stale/large, each file claimed once,
  ids capped) + `/ai-cleanup` that ranks/explains buckets by KEY only (never inventing file ids); a modal
  applies a bucket through the shared `bulkOp` trash path and degrades gracefully without AI. **Still
  deferred:** a true embedding/vector semantic index (no vector store in the stack), offline read cache,
  cross-account/space transfer, file-request links.
