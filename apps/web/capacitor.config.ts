import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Capacitor wraps the SAME Vite build (dist/) into native Android / iOS shells. The mobile app talks to
 * the same Kosh API as the web app (VITE_API_URL at build time) — one backend, one dataset, two clients.
 *
 * Auth on native uses a Bearer session token (cookies are unreliable across a WebView origin and the API
 * host), which the API accepts alongside the cookie session. See docs/MOBILE.md.
 */

/** The API base the bundle is built against: the process env first (CI), then the repo-root `.env` that
 *  Vite reads (`envDir` in vite.config.ts), so `npm run build:mobile` and `vite build` agree. */
function apiUrl(): string {
  if (process.env.VITE_API_URL) return process.env.VITE_API_URL;
  const envFile = resolve(process.cwd(), "../../.env");
  if (!existsSync(envFile)) return "";
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = /^\s*VITE_API_URL\s*=\s*(.*?)\s*$/.exec(line);
    if (m) return m[1].replace(/^(["'])(.*)\1$/, "$2");
  }
  return "";
}

// A plain-http API (the Android emulator's http://10.0.2.2:8787, a LAN IP while testing on a phone)
// needs two dev-only allowances: Android blocks cleartext traffic since API 28, and the WebView's
// https://localhost origin treats an http fetch as mixed content. Both stay OFF for an https API.
const insecureApi = /^http:\/\//i.test(apiUrl());

const config: CapacitorConfig = {
  appId: "com.kosh.app",
  appName: "Kosh",
  webDir: "dist",
  server: {
    // Serve the bundle from https://localhost so secure-context APIs (WebCrypto for the Vault, clipboard)
    // work exactly as on the web. iOS uses capacitor://localhost. Both origins are CORS-allowed by the API.
    androidScheme: "https",
    cleartext: insecureApi,
  },
  android: {
    allowMixedContent: insecureApi,
  },
  ios: {
    contentInset: "automatic",
  },
  plugins: {
    // Requests go through the WebView's own fetch (cookies aren't needed — auth is a Bearer header).
    CapacitorHttp: { enabled: false },
  },
};

export default config;
