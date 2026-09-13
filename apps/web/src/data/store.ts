import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  classifyLink,
  extractVariables,
  lintSkill,
  normalizeUrl,
  parseFrontmatter,
  parseGithubRepo,
  scanSkill,
  siteNameFromUrl,
  type Collection,
  type Item,
  type ItemSource,
  type Skill,
  type SkillFile,
  type Stage,
  type User,
} from "@kosh/shared";
import { uid } from "@/lib/ids";
import { seedCollections, seedItems, seedSkills, seedUser, SEED_FILE_PREVIEWS, SEED_READMES } from "./seed";

export interface DraftSkill {
  kind: "skill";
  name: string;
  files: SkillFile[];
  lint: ReturnType<typeof lintSkill>;
  scan: ReturnType<typeof scanSkill>;
}
export interface DraftFile {
  kind: "file";
  path: string;
  size: number;
  mime: string;
}
export type DropDraft = DraftSkill | DraftFile;

interface DataState {
  user: User;
  items: Item[];
  skills: Skill[];
  collections: Collection[];
  readmes: Record<string, string>;
  filePreviews: Record<string, string>;

  // actions
  ingestUrl: (rawUrl: string, opts?: { note?: string; tags?: string[]; source?: ItemSource; collectionIds?: string[] }) => { item: Item; duplicate: boolean };
  patchItem: (id: string, patch: Partial<Item>) => void;
  setStage: (id: string, stage: Stage) => void;
  snooze: (id: string, days: number) => void;
  setVerdict: (id: string, verdict: string) => void;
  setRating: (id: string, rating: number) => void;
  togglePin: (id: string) => void;
  toggleFavorite: (id: string) => void;
  softDelete: (id: string) => Item | undefined;
  restore: (id: string) => void;
  purge: (id: string) => void;
  emptyTrash: () => void;

  createPrompt: (input: { title: string; body: string; tags?: string[] }) => Item;
  usePrompt: (id: string) => void;

  reviewSkill: (skillId: string) => void;
  toggleSkillPublic: (skillId: string) => void;
  keepCopy: (skillId: string) => void;
  finalizeDrafts: (drafts: DropDraft[], source: ItemSource) => Item[];

  createCollection: (name: string) => Collection;
  toggleItemCollection: (itemId: string, collectionId: string) => void;

  renameTag: (from: string, to: string) => void;
  deleteTag: (tag: string) => void;
  mergeTags: (from: string[], to: string) => void;

  setTheme: (theme: User["settings"]["theme"]) => void;
  resetVault: () => void;
}

function nowIso() {
  return new Date().toISOString();
}

/** Build a plausible enrichment patch for a freshly-ingested URL (demo pipeline). */
function enrichPatch(item: Item): Partial<Item> {
  if (!item.url) return { status: "ready" };
  const repo = item.linkType === "repo" || item.linkType === "issue" || item.linkType === "release" ? parseGithubRepo(item.url) : null;
  if (repo) {
    const stars = 100 + Math.floor(Math.random() * 20000);
    return {
      status: "ready",
      title: `${repo.owner}/${repo.repo}`,
      description: "A GitHub repository saved to your vault.",
      meta: { siteName: "GitHub", favicon: "https://github.com/favicon.ico" },
      github: {
        owner: repo.owner,
        repo: repo.repo,
        stars,
        forks: Math.floor(stars / 12),
        language: ["TypeScript", "Python", "Go", "Rust"][Math.floor(Math.random() * 4)],
        topics: ["saved"],
        license: "MIT",
        pushedAt: nowIso(),
        defaultBranch: "main",
        repoKind: "library",
        repoKindSignals: ["package, no bin"],
        install: { source: "none" },
        snapshotPolicy: "manual",
      },
      ai: { summary: "Fetched metadata for this repository. In production, Kosh enriches this with stars, language, README and an AI summary.", category: "Repository" },
    };
  }
  const site = siteNameFromUrl(item.url);
  return {
    status: "ready",
    title: item.title ?? site,
    description: item.description ?? `Saved from ${site}.`,
    meta: { siteName: site },
    ai: { summary: `Saved from ${site}. In production, Kosh pulls the Open Graph title, image and an AI summary here.`, category: "Link" },
  };
}

let seedCounter = 0;
export const useData = create<DataState>()(
  persist(
    (set, get) => ({
      user: seedUser(),
      items: seedItems(),
      skills: seedSkills(),
      collections: seedCollections(),
      readmes: SEED_READMES,
      filePreviews: SEED_FILE_PREVIEWS,

      ingestUrl: (rawUrl, opts = {}) => {
        const url = normalizeUrl(rawUrl);
        const existing = get().items.find((i) => i.url === url && !i.deletedAt);
        if (existing) return { item: existing, duplicate: true };
        const now = nowIso();
        const item: Item = {
          id: uid("item"),
          kind: "link",
          url,
          originalUrl: rawUrl,
          linkType: classifyLink(url),
          title: siteNameFromUrl(url),
          tags: opts.tags ?? [],
          collections: opts.collectionIds ?? [],
          stage: "to-try",
          source: opts.source ?? "web",
          status: "enriching",
          note: opts.note,
          createdAt: now,
          updatedAt: now,
        };
        set((s) => ({ items: [item, ...s.items] }));
        // simulate async enrichment → materialize
        const delay = 900 + Math.random() * 800;
        window.setTimeout(() => {
          get().patchItem(item.id, enrichPatch(item));
        }, delay);
        return { item, duplicate: false };
      },

      patchItem: (id, patch) =>
        set((s) => ({
          items: s.items.map((i) => (i.id === id ? { ...i, ...patch, updatedAt: nowIso() } : i)),
        })),

      setStage: (id, stage) => get().patchItem(id, { stage }),
      snooze: (id, days) => get().patchItem(id, { snoozedUntil: new Date(Date.now() + days * 86_400_000).toISOString() }),
      setVerdict: (id, verdict) => get().patchItem(id, { verdict, verdictAt: nowIso() }),
      setRating: (id, rating) => get().patchItem(id, { rating }),
      togglePin: (id) => {
        const i = get().items.find((x) => x.id === id);
        if (i) get().patchItem(id, { pinned: !i.pinned });
      },
      toggleFavorite: (id) => {
        const i = get().items.find((x) => x.id === id);
        if (i) get().patchItem(id, { favorite: !i.favorite });
      },

      softDelete: (id) => {
        const item = get().items.find((i) => i.id === id);
        get().patchItem(id, { deletedAt: nowIso() });
        return item;
      },
      restore: (id) => set((s) => ({ items: s.items.map((i) => (i.id === id ? { ...i, deletedAt: undefined, updatedAt: nowIso() } : i)) })),
      purge: (id) =>
        set((s) => {
          const item = s.items.find((i) => i.id === id);
          return {
            items: s.items.filter((i) => i.id !== id),
            skills: item?.skillId ? s.skills.filter((sk) => sk.id !== item.skillId) : s.skills,
          };
        }),
      emptyTrash: () =>
        set((s) => {
          const trashedSkillIds = s.items.filter((i) => i.deletedAt && i.skillId).map((i) => i.skillId);
          return {
            items: s.items.filter((i) => !i.deletedAt),
            skills: s.skills.filter((sk) => !trashedSkillIds.includes(sk.id)),
          };
        }),

      createPrompt: ({ title, body, tags }) => {
        const now = nowIso();
        const item: Item = {
          id: uid("item"),
          kind: "prompt",
          title,
          description: body.slice(0, 120),
          tags: tags ?? [],
          collections: [],
          stage: "to-try",
          source: "web",
          status: "ready",
          prompt: { body, variables: extractVariables(body).map((name) => ({ name })), usedCount: 0 },
          createdAt: now,
          updatedAt: now,
        };
        set((s) => ({ items: [item, ...s.items] }));
        return item;
      },
      usePrompt: (id) =>
        set((s) => ({
          items: s.items.map((i) =>
            i.id === id && i.prompt ? { ...i, prompt: { ...i.prompt, usedCount: i.prompt.usedCount + 1 }, updatedAt: nowIso() } : i,
          ),
        })),

      reviewSkill: (skillId) =>
        set((s) => ({
          skills: s.skills.map((sk) => (sk.id === skillId ? { ...sk, trust: "reviewed", reviewedAt: nowIso(), updatedAt: nowIso() } : sk)),
        })),
      toggleSkillPublic: (skillId) =>
        set((s) => ({
          skills: s.skills.map((sk) => (sk.id === skillId ? { ...sk, public: !sk.public, updatedAt: nowIso() } : sk)),
        })),
      keepCopy: (skillId) =>
        set((s) => ({
          skills: s.skills.map((sk) => (sk.id === skillId ? { ...sk, indexOnly: false, updatedAt: nowIso() } : sk)),
        })),

      finalizeDrafts: (drafts, source) => {
        const created: Item[] = [];
        const now = nowIso();
        for (const d of drafts) {
          if (d.kind === "skill") {
            const entry = d.files.find((f) => /^SKILL\.md$/i.test(f.path));
            const fm = entry?.content ? parseFrontmatter(entry.content).data : {};
            const itemId = uid("item");
            const skillId = uid("skill");
            const skill: Skill = {
              id: skillId,
              itemId,
              name: d.name,
              displayName: (fm.name as string) ?? d.name,
              description: (fm.description as string) ?? undefined,
              tools: ["claude"],
              origin: source === "bot" ? "bot" : "upload",
              trust: "mine",
              license: (fm.license as string) ?? undefined,
              latest: 1,
              usageCount: 0,
              createdAt: now,
              updatedAt: now,
              versions: [
                {
                  n: 1,
                  createdAt: now,
                  entry: entry?.path ?? "SKILL.md",
                  files: d.files,
                  frontmatter: fm,
                  totalSize: d.files.reduce((a, f) => a + f.size, 0),
                  lint: d.lint,
                  scan: d.scan,
                },
              ],
            };
            const item: Item = {
              id: itemId,
              kind: "skill",
              skillId,
              title: skill.displayName,
              description: skill.description,
              tags: ["claude"],
              collections: [],
              stage: "to-try",
              source,
              status: "ready",
              createdAt: now,
              updatedAt: now,
            };
            set((s) => ({ items: [item, ...s.items], skills: [skill, ...s.skills] }));
            created.push(item);
          } else {
            const item: Item = {
              id: uid("item"),
              kind: "file",
              title: d.path,
              description: `Uploaded file (${d.mime}).`,
              tags: [],
              collections: [],
              stage: "to-try",
              source,
              status: "ready",
              fileObject: { path: d.path, size: d.size, mime: d.mime },
              createdAt: now,
              updatedAt: now,
            };
            set((s) => ({ items: [item, ...s.items] }));
            created.push(item);
          }
        }
        return created;
      },

      createCollection: (name) => {
        const col: Collection = {
          id: uid("col"),
          name,
          slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
          order: get().collections.length + 1,
          color: ["#4f46e5", "#14b8a6", "#f59e0b", "#ec4899", "#8b5cf6"][get().collections.length % 5],
        };
        set((s) => ({ collections: [...s.collections, col] }));
        return col;
      },
      toggleItemCollection: (itemId, collectionId) =>
        set((s) => ({
          items: s.items.map((i) => {
            if (i.id !== itemId) return i;
            const has = i.collections.includes(collectionId);
            return {
              ...i,
              collections: has ? i.collections.filter((c) => c !== collectionId) : [...i.collections, collectionId],
              updatedAt: nowIso(),
            };
          }),
        })),

      renameTag: (from, to) =>
        set((s) => ({
          items: s.items.map((i) =>
            i.tags.includes(from) ? { ...i, tags: [...new Set(i.tags.map((t) => (t === from ? to : t)))] } : i,
          ),
        })),
      deleteTag: (tag) =>
        set((s) => ({ items: s.items.map((i) => (i.tags.includes(tag) ? { ...i, tags: i.tags.filter((t) => t !== tag) } : i)) })),
      mergeTags: (from, to) =>
        set((s) => ({
          items: s.items.map((i) => {
            if (!i.tags.some((t) => from.includes(t))) return i;
            return { ...i, tags: [...new Set(i.tags.map((t) => (from.includes(t) ? to : t)))] };
          }),
        })),

      setTheme: (theme) => set((s) => ({ user: { ...s.user, settings: { ...s.user.settings, theme } } })),
      resetVault: () => {
        seedCounter += 1;
        set({
          user: seedUser(),
          items: seedItems(),
          skills: seedSkills(),
          collections: seedCollections(),
          readmes: SEED_READMES,
          filePreviews: SEED_FILE_PREVIEWS,
        });
      },
    }),
    {
      name: "kosh.data.v1",
      partialize: (s) => ({ user: s.user, items: s.items, skills: s.skills, collections: s.collections, readmes: s.readmes, filePreviews: s.filePreviews }),
    },
  ),
);

export const skillForItem = (skills: Skill[], item: Item): Skill | undefined =>
  item.skillId ? skills.find((s) => s.id === item.skillId) : undefined;

// keep the reference so linters don't flag the reseed counter (used to force fresh seeds)
export const __seedCounter = () => seedCounter;
