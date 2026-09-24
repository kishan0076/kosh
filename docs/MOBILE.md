# Kosh on mobile — responsiveness audit + the Android / iOS app

This document is the report for two questions:

1. **Is the web UI responsive and does it work on phones?** — §1 (audit, what was broken, what was fixed).
2. **How do we ship the same app as an Android APK / iOS app on the same backend and data?** — §2–§7
   (approach comparison, the architecture that was implemented, how to build, what's still open).

**TL;DR.** Every screen renders correctly at phone size (390×844) with no horizontal overflow and no
runtime errors; fifteen touch/safe-area/keyboard defects were found and fixed. The mobile app is built with
**Capacitor**: the *exact same* Vite bundle runs inside a native WebView, talks to the *exact same* API and
database, and signs in with a Bearer session token instead of the cookie. The Android APK is produced by a
GitHub Actions workflow (no Android Studio needed); iOS builds from the committed Xcode project.

---

## 1. Responsiveness audit

### 1.1 Method

- **Rendered sweep** — a Playwright script drove a headless Chromium with an iPhone-14-class profile
  (390×844, DPR 2, touch, mobile UA, dark theme) through every route against the real API (dev-login,
  seeded items). For each page it screenshotted, measured `scrollWidth` vs `clientWidth`, listed any element
  extending past the viewport, and collected console/page errors.
- **Code audit** — a read-through of every page/component for the things a render can't show: hover-only
  affordances, fixed-position elements under the home indicator, `<16px` inputs (iOS auto-zoom), viewport
  resize handling when the keyboard opens, full-window OAuth redirects, blob downloads, `webkitdirectory`
  pickers, `Notification`/clipboard/SSE assumptions.
- Two surfaces could not be rendered because they sit behind OAuth (the Drive V2 file manager with a
  connected Google account; the GitHub repo manager with a connected GitHub account). Those were audited
  from code and fixed on the same evidence.

### 1.2 Results — rendered at 390×844

| Route | Overflow | Errors | Notes |
|---|---|---|---|
| `/` Home | none | none | Greeting, quick-add, Today's pick, KPI tiles stack cleanly. |
| Nav drawer | none | none | Off-canvas drawer, scrim, close button; sections + meters fit. |
| `/add` | none | none | Quick-add morphs correctly; drop-zone usable. |
| `/inbox` | none | none | Keyboard triage keys are desktop-only by nature; taps work. |
| `/library` | none | none | Card grid collapses to one column. |
| `/items/:id` | none | none | Detail view stacks; README markdown wraps. |
| `/skills` · `/skills/new` | none | none | Editor panes stack vertically. |
| `/prompts` | none | none | |
| `/github` · `/github/new` | none | none | Connect gate fits; forms stack. |
| `/drive-v2` | none | none | Connect gate fits (file manager audited from code). |
| `/drive` (classic) | none | none | |
| `/collections` · `/trash` | none | none | |
| `/settings` | none | none | Long page; all cards single-column. |
| `/vault` | none | none | Lock screen fits. |
| ⌘K palette | none | none | Full-height sheet on phones. |

Before the fixes below, the pages already *laid out* correctly at phone width — the layout system (Tailwind
breakpoints, the `lg:` sidebar → drawer switch, single-column grids) was sound. What was broken were the
*interaction* details that only show up on a real phone.

### 1.3 Defects found and fixed

| # | Where | Problem on a phone | Fix |
|---|---|---|---|
| 1 | Topbar | A `flex-1` spacer shared the row with the `flex-1` search pill, halving it on phones; no safe-area for the notch/Dynamic Island. | Spacer hidden below `sm`; header height + top padding include `env(safe-area-inset-top)`. |
| 2 | Sidebar drawer | The desktop "collapsed" (icon-only) preference leaked into the mobile drawer → a drawer of unlabeled icons. | Drawer ignores the collapsed pref; safe-area top/bottom padding. |
| 3 | Item cards, Settings tag rows, Drive V2 star buttons, DriveRail collection remove | Actions revealed only on `:hover` → invisible/unreachable on touch. | Always visible on coarse pointers (`[@media(pointer:coarse)]:opacity-100`); tag buttons get bigger hit areas. |
| 4 | Every `Input` / `Textarea` | 13.5px text → iOS Safari zooms the whole page on focus. | 16px on phones, 13.5px from `sm` up. |
| 5 | Dropdown `Menu` | Closed itself when the on-screen keyboard resized the viewport (menus with a search field were unusable); `mousedown` outside-click. | Height-only resizes ignored; `pointerdown` for outside-tap. |
| 6 | Toaster, Drive V2 bulk-progress, GitHub selection bar, Upload tray | Pinned to `bottom-0` → under the iOS home indicator / Android gesture bar; upload tray fixed 320px wide. | `mb-safe` on all; tray `w-[calc(100vw-2rem)] max-w-80`; selection bar rounded-2xl on phones. |
| 7 | Drive V2 context menu | Could extend below the viewport with many actions. | `max-h-[calc(100dvh-1rem)] overflow-y-auto`. |
| 8 | Drive V2 Insights tabs | Tab strip overflowed the panel. | Horizontal scroll, no-wrap tabs. |
| 9 | Drive V2 grid + list skeleton | 176px minimum column → 2 cramped columns; skeleton grid had 5 columns on a 3-column phone row. | 140px min on phones; skeleton mirrors the responsive row template. |
| 10 | `.card-hover` | The `:hover` lift sticks after a tap on touch screens. | Wrapped in `@media (hover: hover)`. |
| 11 | Main scroll area | Content ended under the home indicator. | `pb-safe` on `<main>`. |
| 12 | Connect GitHub / Connect Google | `window.location.href = …` full-window redirects — fine on the web, fatal inside a native WebView (navigates away from the bundle). | One helper, `startConnect()`: web redirects; native opens the system browser and returns by deep link (§3.2). |
| 13 | Downloads (Drive V2 file/ZIP download, exports) | `<a download>` on a blob does nothing useful in a WebView. | `saveBlob()` writes to the app cache and opens the native Share sheet on native; unchanged on web. |
| 14 | Service worker | Would register inside the native shell (pointless, and it caches the wrong origin). | Skipped on native. |
| 15 | Topbar "Sign out" | Was a demo stub toast — a native user could never sign out. | Real sign-out in backend mode (cookie on web, Bearer token on native). |

### 1.4 Known mobile-only gaps that remain (documented, not blocking)

- **Folder pickers** (`webkitdirectory`, File System Access API) — skill-folder and GitHub folder upload are
  desktop features; on phones use multi-file selection / a ZIP where offered. Native file-system access is a
  follow-up (`@capacitor/filesystem` directory picker + a native share-target intent).
- **Vault category chip row** and a few dense toolbars scroll horizontally rather than wrap — usable, not
  pretty.
- **Drive previews** embed Google's viewer in an iframe, which needs Google cookies in the WebView — works
  once you've signed into Google in the in-app browser; otherwise falls back to "Open in Drive".
- Desktop-only keyboard shortcuts (Inbox triage keys, `j`/`k`) have tap equivalents everywhere.

---

## 2. Which approach — and why Capacitor

| Approach | What it is | Same backend/data | Effort | Verdict |
|---|---|---|---|---|
| **PWA (installable web app)** | What Kosh already ships (manifest, SW, share target). | ✅ | 0 | Great on Android, weak on iOS (no share target, 7-day storage eviction, no store listing), **not an APK**. |
| **TWA / Bubblewrap** | An Android-only shell that opens the *hosted* PWA in Chrome. | ✅ | low | Produces an APK, but it's a browser window: no deep-link OAuth control, needs the web app publicly hosted with an asset-links file, **no iOS**. |
| **Capacitor (chosen)** | The Vite `dist/` runs inside a native WebView; native APIs via plugins. Native Android Studio + Xcode projects are generated and committed. | ✅ | **low–medium** | One codebase, one build, one API. Real APK/AAB and IPA, store-ready, native share sheet / file system / preferences / deep links available as needed. All existing React code, routing, state and design system are reused **unchanged**. |
| **React Native / Expo** | Rewrite the UI in RN components. | ✅ (API is client-agnostic) | **very high** | The UI is ~25k lines of DOM/Tailwind/`motion`/`cmdk`/`react-markdown`; none of it is portable. Only justified for heavy native UI (offline-first sync, background uploads). |
| **Flutter / Kotlin+Swift** | Full rewrite per platform. | ✅ | highest | Not justified. |

Capacitor is the only option that ships a real Android/iOS app *without* forking the front-end. The
trade-offs are those of any WebView app — no native scrolling physics in lists (mitigated by
`@tanstack/react-virtual` in Drive V2), and OAuth must be done in the system browser (implemented in §3).

---

## 3. Architecture — one backend, two clients

```
                ┌──────────────────────────────┐
  Browser  ───▶ │  apps/web  (Vite bundle)      │ ◀─── Native WebView (Capacitor, Android / iOS)
                └──────────────┬───────────────┘
                               │  same REST calls, same @kosh/shared types
                               ▼
                ┌──────────────────────────────┐
                │  apps/api  (Express)          │  cookie session  (web)
                │  one database, one user set   │  Bearer session  (native)  ← the only new thing
                └──────────────────────────────┘
```

Nothing is duplicated. The mobile app is `VITE_API_URL=<your API> vite build` wrapped by Capacitor. Every
feature that exists on the web exists in the app, reading and writing the same rows.

### 3.1 Sessions on native — Bearer token instead of the cookie

The web app uses an httpOnly `kosh_session` cookie. Inside a native WebView the page origin is
`https://localhost` (Android) / `capacitor://localhost` (iOS) and the API is on another host; cross-site
cookie handling there is inconsistent (ITP on iOS, third-party-cookie blocking, `SameSite`), so the app
carries the session explicitly:

- `attachUser` middleware (`apps/api/src/auth/middleware.ts`) accepts `Authorization: Bearer <session JWT>`
  in addition to the cookie and to `ksh_…` API keys. It is the **same JWT** `signSession()` puts in the cookie.
- The client (`apps/web/src/data/api.ts` → `req()`) adds the header when a token is loaded; the token lives
  in `@capacitor/preferences` (`apps/web/src/lib/native.ts`), never in `localStorage`.
- `useData.initBackend()` primes the token, then calls `GET /me`. On native, a 401 shows the **sign-in
  screen** (`components/LoginScreen.tsx`); the web keeps its existing behaviour. `signOut()` clears it.

### 3.2 OAuth from a native app — system browser + deep link

A WebView must never navigate away from the bundle, and OAuth providers refuse to run inside WebViews
anyway. So every OAuth flow (GitHub sign-in, Connect GitHub, Connect Google Drive) is:

```
app ── openExternal(url) ──▶ system browser (Chrome Custom Tab / SFSafariViewController)
                               user consents at GitHub / Google
                               API callback finishes exactly as on the web (tokens stored server-side)
                               API redirects to  kosh://auth?code=…   or   kosh://connected?provider=…
app ◀── App "appUrlOpen" ──── OS opens the app by its URL scheme
```

- **Sign-in:** `GET /api/auth/github?client=mobile` — the `client` suffix rides inside the CSRF state cookie
  the browser already holds. The callback mints a **single-use, 2-minute exchange code** (a purpose-scoped
  JWT) and redirects to `kosh://auth?code=…`; the app calls `POST /api/auth/mobile/exchange` and receives
  `{ token, user }`. The session JWT itself never travels through a URL.
- **Connect GitHub / Google:** `GET /api/github/auth?client=mobile` and `GET /api/drive/auth?client=mobile`
  (called over the Bearer channel) return `{ url }` instead of redirecting; the callback trusts the signed
  state's `uid` (`client: "mobile"` is baked into the state JWT) and finishes with `kosh://connected?…`.
  `AppShell` toasts and refreshes `/me`.
- Same GitHub OAuth App and Google OAuth client as the web: the callback URLs don't change. Only the *final*
  hop differs.
- The URL scheme is `MOBILE_SCHEME` (default `kosh`) on the API and is registered in
  `android/app/src/main/AndroidManifest.xml` (`<data android:scheme="kosh" />`) and
  `ios/App/App/Info.plist` (`CFBundleURLTypes`). Change all three together.

### 3.3 CORS

`config.appOrigins` = `APP_URL` + `capacitor://localhost` + `https://localhost` + anything in the new
`APP_ORIGINS` (comma-separated). Unknown origins get no `Access-Control-Allow-Origin` (verified).

### 3.4 What is identical and what differs

| | Web | Native app |
|---|---|---|
| UI, routing, state, design system | same bundle | same bundle |
| API + database | same | same |
| Auth carrier | httpOnly cookie | Bearer session token (Preferences) |
| Sign-in / Connect | full-page redirect | system browser + `kosh://` deep link |
| Downloads | `<a download>` | write to cache + native Share sheet |
| Service worker / PWA share target | on | off (native shell) |
| Live updates (SSE) | on | **off** — `EventSource` can't send a Bearer header; data refreshes on navigation/refetch (follow-up in §6) |
| Safe areas | n/a | `pt-safe` / `pb-safe` / `mb-safe` utilities (`env(safe-area-inset-*)`) |

---

## 4. What changed (file map)

**API (`apps/api`)**
- `src/auth/middleware.ts` — Bearer *session* JWT accepted (besides API keys).
- `src/auth/jwt.ts` — `signState/verifyState` gain `client` + `ttl` options (mobile-scoped state).
- `src/auth/routes.ts` — `?client=mobile` on `/auth/github`; deep-link redirect in the callback;
  `POST /auth/mobile/exchange` (single-use); dev-login returns `token` for `client: "mobile"`.
- `src/routes/githubAuth.ts`, `src/routes/drive.ts` — `?client=mobile` start returns JSON; callbacks
  finish via deep link and trust the signed state's uid.
- `src/config.ts`, `src/app.ts` — `appOrigins` (+ `APP_ORIGINS`), `mobileScheme` (`MOBILE_SCHEME`), CORS list.

**Web (`apps/web`)**
- `capacitor.config.ts` — app id `com.kosh.app`, `webDir: dist`, `androidScheme: https`; dev-only
  cleartext/mixed-content allowances switch on automatically when `VITE_API_URL` is plain `http://`.
- `android/`, `ios/` — the generated native projects (committed; build outputs and copied web assets are
  git-ignored), with the `kosh` URL scheme registered.
- `src/lib/native.ts` — `isNative`, token storage, `openExternal/closeExternal`, `onDeepLink`.
- `src/lib/connect.ts` — `startConnect(provider, from)` used by every Connect button.
- `src/lib/download.ts` — native Share-sheet path for `saveBlob`.
- `src/components/LoginScreen.tsx` — native sign-in screen (GitHub; optional dev sign-in).
- `src/components/layout/AppShell.tsx` — deep-link handling, login gate, safe-area main.
- `src/data/api.ts`, `src/data/driveApi.ts`, `src/data/store.ts` — Bearer header, mobile endpoints,
  `needsLogin` / `completeLogin` / `signOut`.
- `src/index.css`, `Topbar.tsx`, `Sidebar.tsx`, `ui.tsx`, `overlays.tsx`, `Toaster.tsx`, `ItemCard.tsx`,
  `Settings.tsx`, `GithubV2.tsx`, `DriveV2.tsx`, `Drive.tsx`, `drive-v2/*` — the §1.3 fixes.
- `package.json` — Capacitor deps + `build:mobile`, `cap:sync`, `cap:android`, `cap:ios`, `cap:run:*`.

**Repo**
- `.github/workflows/android.yml` — builds the debug APK on every push to `main` touching the web app, and
  on demand.
- `.env.example` — `APP_ORIGINS`, `MOBILE_SCHEME`.

---

## 5. Building and running the app

### 5.1 Configuration

| Variable | Where | Meaning |
|---|---|---|
| `VITE_API_URL` | build-time (web) | The API the app talks to, e.g. `https://api.example.com/api`. **Must be reachable from the phone** — `localhost` is the phone itself. Android emulator → `http://10.0.2.2:8787/api`; a phone on your Wi-Fi → `http://192.168.x.x:8787/api` (start the API with `API_URL` set to that too, so OAuth callbacks resolve). |
| `VITE_DEV_LOGIN=1` | build-time (web) | Shows the **Dev sign-in** button in the app. The API only honours it when its own `DEV_LOGIN=1` (never in production). |
| `MOBILE_SCHEME` | API | URL scheme for deep links (default `kosh`). Must match the manifest / plist. |
| `APP_ORIGINS` | API | Extra CORS origins (the native ones are always included). |
| `GITHUB_CLIENT_ID/SECRET`, `GOOGLE_CLIENT_ID/SECRET` | API | Same OAuth apps as the web; no change needed. |

### 5.2 Android — from GitHub Actions (no local SDK)

1. In the repo: **Settings → Secrets and variables → Actions → Variables** → add `MOBILE_API_URL`
   (e.g. `https://api.example.com/api`; for a phone on your LAN, `http://192.168.1.20:8787/api`).
   Optionally `MOBILE_DEV_LOGIN` = `1` for a test build.
2. **Actions → "Android APK" → Run workflow** (or push to `main`).
3. Download the `kosh-debug-apk` artifact, copy `app-debug.apk` to the phone, allow "install unknown apps",
   install.

The workflow runs `npm ci` → `vite build` → `cap sync android` → `./gradlew assembleDebug` on Ubuntu with
Java 21 and the runner's Android SDK.

### 5.3 Android — locally (Android Studio)

```bash
npm install
npm run build:mobile -w @kosh/web      # vite build + cap sync (reads VITE_API_URL from the root .env)
npm run cap:android -w @kosh/web       # opens apps/web/android in Android Studio → Run ▶ (device or emulator)
# or, headless:
cd apps/web/android && ./gradlew assembleDebug   # → app/build/outputs/apk/debug/app-debug.apk
```

Requirements: Android Studio (Ladybug or newer), JDK 21, SDK 35. Live-reload during development:
`npx cap run android --livereload --external` from `apps/web` with `vite dev` running.

### 5.4 iOS — Xcode

Needs a Mac with Xcode 16+, CocoaPods (`brew install cocoapods`), and an Apple Developer account for a device.

```bash
npm run build:mobile -w @kosh/web
npm run cap:ios -w @kosh/web           # opens apps/web/ios/App/App.xcworkspace
```

In Xcode: select the *App* target → Signing & Capabilities → pick your Team (bundle id `com.kosh.app`) →
Run ▶ on a simulator or device. Archive → Distribute for TestFlight / App Store.

### 5.5 Release builds

**Android (signed APK/AAB):**

```bash
keytool -genkeypair -v -keystore kosh-release.jks -alias kosh -keyalg RSA -keysize 2048 -validity 10000
```

Put the keystore outside the repo (or as CI secrets — `*.jks` and `keystore.properties` are git-ignored),
add a `signingConfigs.release` block to `android/app/build.gradle` pointing at it, then
`./gradlew bundleRelease` (Play Store, `.aab`) or `assembleRelease` (sideload, `.apk`). In CI: store the
keystore base64-encoded in a secret, decode it in a step, and swap `assembleDebug` for `bundleRelease`.
Bump `versionCode`/`versionName` in `android/app/build.gradle` per release.

**iOS:** Xcode → Product → Archive → Organizer → Distribute (TestFlight/App Store). Uses the bundle id and
team from §5.4.

**App icon / splash:** the projects ship Capacitor's default launcher icon. Generate Kosh's from the
existing SVG once: `npx @capacitor/assets generate --iconBackgroundColor '#0b1020' --splashBackgroundColor '#0b1020'`
with `assets/icon.png` (1024²) and `assets/splash.png` (2732²) exported from `apps/web/public/icon.svg`.

### 5.6 Testing on a real phone against your laptop's API

1. Find the laptop's LAN IP (`ipconfig` / `ifconfig`), e.g. `192.168.1.20`.
2. In the root `.env`: `VITE_API_URL=http://192.168.1.20:8787/api`, `API_URL=http://192.168.1.20:8787`,
   `APP_URL=http://192.168.1.20:5173`, `DEV_LOGIN=1`. If you use GitHub sign-in, the OAuth app's callback
   must be `http://192.168.1.20:8787/api/auth/github/callback` (GitHub allows an http callback for dev).
3. `npm run api` (or `npm run dev`), phone on the same Wi-Fi, build with `VITE_DEV_LOGIN=1`, install, open.
   The plain-`http://` URL switches on the cleartext allowance automatically (§4).

---

## 6. Follow-ups (not done, in priority order)

1. **Live updates on native** — `EventSource` can't set headers. Add `GET /api/events?ticket=…` where the
   ticket is a 60-second purpose-scoped JWT minted by `POST /api/events/ticket` over Bearer, then enable
   `api.events()` on native. Drive V2's push-sync engine needs the same ticket. (Half a day.)
2. **Native share target** — an Android `SEND` intent filter + iOS Share Extension so "Share to Kosh" from any
   app saves a link (the PWA share target does this on the web). `@capacitor/share` only *sends*; receiving
   needs a small plugin (e.g. `capacitor-share-target`/`send-intent`) wired to `/share?url=`.
3. **Local notifications** for watched-repo changes (`@capacitor/local-notifications`) instead of the
   `Notification` API, and a **badge**.
4. **Clipboard** via `@capacitor/clipboard` where `navigator.clipboard` is denied in the WebView (prompt
   fill-and-copy). Works today on Android; iOS occasionally needs the plugin.
5. **Vault auto-lock** when the app goes to the background (`App` `appStateChange`), plus biometric unlock
   (`capacitor-native-biometric`).
6. **Fonts offline** — the design system loads Google Fonts from the CDN; bundle them for a cold-start
   without network.
7. **Folder pickers** — native directory access for skill/GitHub folder uploads.
8. **Store listing** — icons/splash (§5.5), privacy policy URL, screenshots, Play/App Store review.

---

## 7. Go-live checklist

- [ ] API deployed over **HTTPS**; `MOBILE_API_URL` set to it; `DEV_LOGIN` **off** in production.
- [ ] `MOBILE_SCHEME` unchanged (or changed in manifest + plist together).
- [ ] GitHub OAuth App callback = `https://<api>/api/auth/github/callback` (already true for the web).
- [ ] Signed release build (§5.5); `versionCode` bumped.
- [ ] Icons/splash generated.
- [ ] Smoke test on a device: sign in → item saved on the phone appears on the web (and vice versa) → Connect
      GitHub → Drive download opens the Share sheet → sign out returns to the sign-in screen.
