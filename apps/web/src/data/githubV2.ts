import { create } from "zustand";
import { githubV2Api, type RepoSort, type RepoSummary } from "./githubV2Api";
import { useUi } from "./ui";

export type RepoFilter = "all" | "public" | "private" | "sources" | "forks" | "archived" | "templates";
export type RepoLayout = "grid" | "list";

const PREFS_KEY = "kosh.githubV2.prefs";
interface Prefs {
  sort: RepoSort;
  filter: RepoFilter;
  layout: RepoLayout;
}
const DEFAULT_PREFS: Prefs = { sort: "pushed", filter: "all", layout: "grid" };
function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw ? { ...DEFAULT_PREFS, ...JSON.parse(raw) } : DEFAULT_PREFS;
  } catch {
    return DEFAULT_PREFS;
  }
}
function savePrefs(p: Prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* private mode */
  }
}

const MAX_PAGES = 10; // safety cap: up to ~1000 repos loaded for instant client-side search/sort/filter

interface GithubV2State {
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
  repos: RepoSummary[];
  truncated: boolean; // more repos exist than we loaded (past the page cap)

  query: string;
  prefs: Prefs;

  load: (force?: boolean) => Promise<void>;
  setQuery: (q: string) => void;
  setSort: (s: RepoSort) => void;
  setFilter: (f: RepoFilter) => void;
  setLayout: (l: RepoLayout) => void;

  upsertRepo: (repo: RepoSummary) => void;
  removeRepo: (fullName: string) => void;
}

let loadSeq = 0;

export const useGithubV2 = create<GithubV2State>((set, get) => ({
  status: "idle",
  error: null,
  repos: [],
  truncated: false,
  query: "",
  prefs: loadPrefs(),

  load: async (force = false) => {
    if (get().status === "loading" && !force) return;
    const seq = ++loadSeq;
    set({ status: "loading", error: null });
    try {
      const all: RepoSummary[] = [];
      let page = 1;
      let truncated = false;
      for (;;) {
        const res = await githubV2Api.listRepos({ page, perPage: 100, sort: get().prefs.sort });
        if (seq !== loadSeq) return; // superseded by a newer load
        all.push(...res.repos);
        if (!res.hasMore) break;
        if (page >= MAX_PAGES) {
          truncated = true;
          break;
        }
        page++;
      }
      if (seq !== loadSeq) return;
      // Dedup by id (org + collaborator affiliations can overlap).
      const byId = new Map<number, RepoSummary>();
      for (const r of all) byId.set(r.id, r);
      set({ repos: [...byId.values()], truncated, status: "ready" });
    } catch (err) {
      if (seq !== loadSeq) return;
      set({ status: "error", error: err instanceof Error ? err.message : "Couldn't load your repositories." });
    }
  },

  setQuery: (q) => set({ query: q }),
  setSort: (s) => set((st) => { const prefs = { ...st.prefs, sort: s }; savePrefs(prefs); return { prefs }; }),
  setFilter: (f) => set((st) => { const prefs = { ...st.prefs, filter: f }; savePrefs(prefs); return { prefs }; }),
  setLayout: (l) => set((st) => { const prefs = { ...st.prefs, layout: l }; savePrefs(prefs); return { prefs }; }),

  upsertRepo: (repo) =>
    set((s) => {
      const idx = s.repos.findIndex((r) => r.id === repo.id);
      if (idx === -1) return { repos: [repo, ...s.repos] };
      const next = s.repos.slice();
      next[idx] = repo;
      return { repos: next };
    }),
  removeRepo: (fullName) => set((s) => ({ repos: s.repos.filter((r) => r.fullName !== fullName) })),
}));

/** Push a toast from outside a component. */
export function ghToast(message: string, tone: "ok" | "danger" | "warn" | "default" = "default"): void {
  useUi.getState().toast({ message, tone });
}

/* ── derived (pure) ── */

const SORTERS: Record<RepoSort, (a: RepoSummary, b: RepoSummary) => number> = {
  pushed: (a, b) => (b.pushedAt ?? "").localeCompare(a.pushedAt ?? ""),
  updated: (a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""),
  created: (a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""),
  full_name: (a, b) => a.fullName.localeCompare(b.fullName),
};

function matchesFilter(r: RepoSummary, f: RepoFilter): boolean {
  switch (f) {
    case "public": return !r.private;
    case "private": return r.private;
    case "sources": return !r.fork;
    case "forks": return r.fork;
    case "archived": return r.archived;
    case "templates": return r.template;
    default: return true;
  }
}

/** Apply the query + filter + sort to the loaded repos. */
export function visibleRepos(repos: RepoSummary[], query: string, prefs: Prefs): RepoSummary[] {
  const q = query.trim().toLowerCase();
  const filtered = repos.filter((r) => {
    if (!matchesFilter(r, prefs.filter)) return false;
    if (!q) return true;
    return (
      r.fullName.toLowerCase().includes(q) ||
      (r.description ?? "").toLowerCase().includes(q) ||
      (r.language ?? "").toLowerCase().includes(q) ||
      r.topics.some((t) => t.toLowerCase().includes(q))
    );
  });
  return filtered.sort(SORTERS[prefs.sort]);
}
