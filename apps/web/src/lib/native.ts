import { Capacitor } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";
import { Browser } from "@capacitor/browser";
import { App } from "@capacitor/app";

/* ── Native (Capacitor) bridge ────────────────────────────────────────────────
 * The mobile app is the SAME web bundle inside a native WebView. Everything here is a no-op on the web,
 * so the rest of the code can call it unconditionally. Two things differ on native:
 *  1. Auth is a Bearer session token (stored in native Preferences) instead of the httpOnly cookie —
 *     a WebView at capacitor://localhost can't reliably carry a cross-site cookie to the API host.
 *  2. OAuth flows (login, Connect GitHub, Connect Google) open in the SYSTEM browser and come back via
 *     the kosh:// deep link, instead of navigating the WebView away from the bundle. */

export const isNative: boolean = Capacitor.isNativePlatform();
export const nativePlatform: "ios" | "android" | "web" = Capacitor.getPlatform() as "ios" | "android" | "web";

const TOKEN_KEY = "kosh.session";
let cachedToken: string | null | undefined; // undefined = not loaded yet

/** Prime the token cache from native storage (call once before the first API request). */
export async function loadSessionToken(): Promise<string | null> {
  if (!isNative) return (cachedToken = null);
  if (cachedToken !== undefined) return cachedToken;
  try {
    const { value } = await Preferences.get({ key: TOKEN_KEY });
    cachedToken = value || null;
  } catch {
    cachedToken = null;
  }
  return cachedToken;
}

/** Synchronous read for the request path (the cache is primed by loadSessionToken / setSessionToken). */
export function getSessionTokenSync(): string | null {
  return cachedToken ?? null;
}

export async function getSessionToken(): Promise<string | null> {
  return loadSessionToken();
}

export async function setSessionToken(token: string | null): Promise<void> {
  cachedToken = token;
  if (!isNative) return;
  try {
    if (token) await Preferences.set({ key: TOKEN_KEY, value: token });
    else await Preferences.remove({ key: TOKEN_KEY });
  } catch {
    /* storage unavailable — the in-memory cache still carries this session */
  }
}

/** Open a URL that must run OUTSIDE the app's WebView (OAuth consent pages). On the web, plain navigation. */
export async function openExternal(url: string): Promise<void> {
  if (isNative) {
    await Browser.open({ url, presentationStyle: "popover" });
    return;
  }
  window.location.href = url;
}

/** Best-effort close of the in-app browser sheet after a deep link brings us back. */
export async function closeExternal(): Promise<void> {
  if (!isNative) return;
  try {
    await Browser.close();
  } catch {
    /* not open */
  }
}

/** Listen for kosh://… deep links (OAuth returns). Returns an unsubscribe. No-op on the web.
 *  Cold starts are covered too: both native App plugins retain the launch URL's `appUrlOpen` event until
 *  the first listener consumes it, so a link that *launched* the app still lands here. */
export function onDeepLink(handler: (url: URL) => void): () => void {
  if (!isNative) return () => {};
  const sub = App.addListener("appUrlOpen", (e) => {
    try {
      handler(new URL(e.url));
    } catch {
      /* not a URL we understand */
    }
  });
  return () => {
    void sub.then((s) => s.remove());
  };
}
