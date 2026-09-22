import { useEffect, useMemo, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useDriveV2, type DriveView } from "./driveV2";

/**
 * Deep-linkable Drive V2 routing.
 *
 * The store stays the single source of truth for navigation (so every existing action — nav buttons,
 * folder opens, search, ⌘K — keeps its exact behavior). This module mirrors that state to the URL and,
 * on a real browser navigation (deep-link, refresh, Back/forward), applies the URL back to the store.
 *
 * The two directions never fight: while an inbound URL is being applied we suppress the outbound mirror
 * (`applying` guard), and each outbound write records the URL it produced (`lastApplied`) so the inbound
 * effect skips our own pushes. zustand's `set` is synchronous, so an inbound apply updates the store
 * before the outbound effect runs in the same commit.
 */

export const DRIVE_V2_BASE = "/drive-v2";

const VIEW_SLUG: Record<DriveView, string> = {
  myDrive: "my-drive",
  recent: "recent",
  starred: "starred",
  shared: "shared",
  trash: "trash",
  search: "search",
};

function slugToView(slug: string): DriveView | null {
  for (const v of Object.keys(VIEW_SLUG) as DriveView[]) if (VIEW_SLUG[v] === slug) return v;
  return null;
}

/** The "pane" a location addresses — a view, or one of the two full-pane overlays. */
export type DrivePane = DriveView | "insights" | "activity";

export interface DriveUrlState {
  view: DriveView;
  insightsOpen: boolean;
  activityOpen: boolean;
  searchQuery: string;
  spaceId: string | null;
  folderId: string | null;
}

/** Stable key for the active pane — drives the page-transition crossfade. */
export function drivePaneKey(s: Pick<DriveUrlState, "view" | "insightsOpen" | "activityOpen">): DrivePane {
  if (s.activityOpen) return "activity";
  if (s.insightsOpen) return "insights";
  return s.view;
}

/** The URL (pathname + search) that represents a given store state. */
export function driveUrlFromState(s: DriveUrlState): string {
  if (s.activityOpen) return `${DRIVE_V2_BASE}/activity`;
  if (s.insightsOpen) return `${DRIVE_V2_BASE}/insights`;
  const params = new URLSearchParams();
  if (s.view === "search" && s.searchQuery) params.set("q", s.searchQuery);
  // Folders are addressable only for My Drive on the primary corpus; Shared-Drive folder nav stays
  // session-only (the space isn't in the URL, so a cold folder link there couldn't be scoped correctly).
  if (s.view === "myDrive" && !s.spaceId && s.folderId) params.set("folder", s.folderId);
  const qs = params.toString();
  return `${DRIVE_V2_BASE}/${VIEW_SLUG[s.view]}${qs ? `?${qs}` : ""}`;
}

/** The canonical URL for the store's CURRENT state (read live from the store). */
function canonicalUrlFromStore(): string {
  const s = useDriveV2.getState();
  return driveUrlFromState({
    view: s.view,
    insightsOpen: s.insightsOpen,
    activityOpen: s.activityOpen,
    searchQuery: s.searchQuery,
    spaceId: s.spaceId,
    folderId: s.path.at(-1)?.id ?? null,
  });
}

/** Apply the state a location implies to the store. Idempotent: only genuine diffs call a setter. */
async function applyUrlToStore(pathname: string, search: string): Promise<void> {
  const s = useDriveV2.getState();
  const seg = pathname.replace(/^\/+/, "").split("/")[1] ?? ""; // ["drive-v2", "<seg>"]
  const params = new URLSearchParams(search);

  if (seg === "activity") {
    if (!s.activityOpen) s.setActivity(true);
    return;
  }
  if (seg === "insights") {
    if (!s.insightsOpen) s.setInsights(true);
    return;
  }

  // A view segment shows content — close any full-pane overlay first.
  if (s.activityOpen) s.setActivity(false);
  if (s.insightsOpen) s.setInsights(false);

  const view = slugToView(seg) ?? "myDrive";

  if (view === "search") {
    const q = params.get("q") ?? "";
    if (s.view !== "search" || s.searchQuery !== q) {
      if (q) s.runSearch(q);
      else if (s.view !== "search") s.setView("search");
    }
    return;
  }

  if (s.view !== view) s.setView(view);

  // Folder deep-link (My Drive, primary corpus only). Re-read state after setView.
  if (view === "myDrive" && !useDriveV2.getState().spaceId) {
    const folder = params.get("folder");
    const cur = useDriveV2.getState().path.at(-1)?.id ?? null;
    if ((folder ?? null) !== cur) {
      if (folder) await useDriveV2.getState().loadPath(folder);
      else useDriveV2.getState().goRoot();
    }
  }
}

/**
 * Keep the URL and the Drive V2 store in sync. Mount inside the connected shell (where the store is
 * ready). Returns nothing — it wires up two effects.
 */
export function useDriveV2UrlSync(): void {
  const location = useLocation();
  const navigate = useNavigate();

  const view = useDriveV2((s) => s.view);
  const insightsOpen = useDriveV2((s) => s.insightsOpen);
  const activityOpen = useDriveV2((s) => s.activityOpen);
  const searchQuery = useDriveV2((s) => s.searchQuery);
  const spaceId = useDriveV2((s) => s.spaceId);
  const folderId = useDriveV2((s) => s.path.at(-1)?.id ?? null);

  const desiredUrl = useMemo(
    () => driveUrlFromState({ view, insightsOpen, activityOpen, searchQuery, spaceId, folderId }),
    [view, insightsOpen, activityOpen, searchQuery, spaceId, folderId],
  );

  const lastApplied = useRef<string | null>(null);
  const applying = useRef(false);

  // URL → store (deep-link, refresh, Back/forward). Declared FIRST so a cold deep-link is applied
  // before the outbound mirror could overwrite it.
  useEffect(() => {
    const current = location.pathname + location.search;
    if (current === lastApplied.current) return; // our own push — already reflected in the store
    lastApplied.current = current;
    applying.current = true;
    void applyUrlToStore(location.pathname, location.search).finally(() => {
      applying.current = false;
      // Reconcile: the store can't always represent the applied URL (a `?folder=` link while a Shared
      // Drive is active, or the bare `/drive-v2` path). Snap the URL to the store's canonical URL so the
      // address bar never lies and Back always lands somewhere truthful. No loop: `lastApplied` makes the
      // inbound effect skip this push, and the outbound effect sees `desiredUrl === current`.
      const canonical = canonicalUrlFromStore();
      if (canonical !== location.pathname + location.search) {
        lastApplied.current = canonical;
        navigate(canonical, { replace: true });
      }
    });
  }, [location.pathname, location.search, navigate]);

  // store → URL. Suppressed while an inbound apply runs so the two directions never ping-pong.
  useEffect(() => {
    if (applying.current) return;
    const current = location.pathname + location.search;
    if (desiredUrl === current) return;
    lastApplied.current = desiredUrl;
    // Collapse the initial bare-path redirect and live search refinement into the current history entry;
    // every other transition pushes so the browser Back button walks the navigation.
    const bare = location.pathname === DRIVE_V2_BASE || location.pathname === `${DRIVE_V2_BASE}/`;
    const searchRefine = current.startsWith(`${DRIVE_V2_BASE}/search`) && desiredUrl.startsWith(`${DRIVE_V2_BASE}/search`);
    navigate(desiredUrl, { replace: bare || searchRefine });
  }, [desiredUrl, location.pathname, location.search, navigate]);
}
