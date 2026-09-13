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
  type SkillVersion,
  type Stage,
  type Tool,
  type User,
} from "@kosh/shared";
import { uid } from "@/lib/ids";
import { api, backendEnabled, uploadObjects } from "./api";
import { seedCollections, seedItems, seedSkills, seedUser, SEED_FILE_PREVIEWS, SEED_READMES } from "./seed";

export interface DraftSkill {
  kind: "skill";
  name: string;
  files: SkillFile[];
  blobs?: { path: string; mime: string; blob: Blob }[]; // raw bytes for direct upload (§6.2)
  lint: ReturnType<typeof lintSkill>;
  scan: ReturnType<typeof scanSkill>;
}
export interface DraftFile {
  kind: "file";
  path: string;
  size: number;
  mime: string;
  blob?: Blob; // raw bytes for direct upload (§6.2)
}
export type DropDraft = DraftSkill | DraftFile;

const nowIso = () => new Date().toISOString();
const isOptimistic = (id: string) => id.startsWith("item_") || id.startsWith("skill_") || id.startsWith("col_");

// Fields the API PATCH /items accepts.
const PATCH_KEYS = ["stage", "rating", "verdict", "note", "title", "description", "tags", "collections", "pinned", "favorite", "foundVia", "snoozedUntil"] as const;
function apiItemPatch(patch: Partial<Item>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of PATCH_KEYS) if (patch[k] !== undefined) out[k] = patch[k];
  // foundVia can be explicitly cleared — send null so the server unsets it.
  if ("foundVia" in patch && patch.foundVia === undefined) out.foundVia = null;
  if (patch.github?.watch) out.watch = { enabled: patch.github.watch.enabled };
  if (patch.github?.snapshotPolicy) out.snapshotPolicy = patch.github.snapshotPolicy;
  return out;
}

interface DataState {
  user: User;
  items: Item[];
  skills: Skill[];
  collections: Collection[];
  readmes: Record<string, string>;
  filePreviews: Record<string, string>;
  hydrated: boolean;
  backend: boolean;

  initBackend: () => Promise<void>;
  upsertItem: (item: Item) => void;
  upsertSkill: (skill: Skill) => void;

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
  saveSkillEdit: (input: { skillId?: string; name: string; content: string; tools?: Tool[]; note?: string }) => Item | undefined;
  extractLinks: (itemId: string) => Promise<{ found: number; saved: number; skipped: number }>;
  snapshotSkills: (itemId: string, dirs?: string[]) => Promise<number>;
  finalizeDrafts: (drafts: DropDraft[], source: ItemSource) => Item[];

  createCollection: (name: string) => Collection;
  toggleItemCollection: (itemId: string, collectionId: string) => void;

  renameTag: (from: string, to: string) => void;
  deleteTag: (tag: string) => void;
  mergeTags: (from: string[], to: string) => void;

  setTheme: (theme: User["settings"]["theme"]) => void;
  resetVault: () => void;
}

/** Build a plausible enrichment patch for a freshly-ingested URL (mock pipeline). */
function enrichPatch(item: Item): Partial<Item> {
  if (!item.url) return { status: "ready" };
  const repo = item.linkType === "repo" ? parseGithubRepo(item.url) : null;
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
        install: { source: "none" },
        snapshotPolicy: "manual",
      },
      ai: { summary: "Fetched metadata for this repository (mock). Connect the API for live GitHub enrichment.", category: "Repository" },
    };
  }
  const site = siteNameFromUrl(item.url);
  return { status: "ready", title: item.title ?? site, description: item.description ?? `Saved from ${site}.`, meta: { siteName: site } };
}

const emptyUser = (): User => ({ ...seedUser(), id: "loading", name: "…", login: "…" });

export const useData = create<DataState>()(
  persist(
    (set, get) => ({
      user: backendEnabled ? emptyUser() : seedUser(),
      items: backendEnabled ? [] : seedItems(),
      skills: backendEnabled ? [] : seedSkills(),
      collections: backendEnabled ? [] : seedCollections(),
      readmes: SEED_READMES,
      filePreviews: SEED_FILE_PREVIEWS,
      hydrated: !backendEnabled,
      backend: backendEnabled,

      initBackend: async () => {
        if (!backendEnabled || get().hydrated) return;
        try {
          try {
            await api.me();
          } catch {
            await api.devLogin("darshan", "Darshan");
          }
          const [me, items, trash, skills, collections] = await Promise.all([
            api.me(),
            api.listItems(),
            api.listTrash(),
            api.listSkills(),
            api.listCollections(),
          ]);
          set({ user: me.user, items: [...items.items, ...trash.items], skills: skills.skills, collections: collections.collections, hydrated: true });
          api.events((evt) => {
            if ((evt.kind === "item.created" || evt.kind === "item.updated") && evt.item) get().upsertItem(evt.item);
          });
        } catch (err) {
          console.error("Kosh: backend hydrate failed, falling back to demo data", err);
          set({ user: seedUser(), items: seedItems(), skills: seedSkills(), collections: seedCollections(), hydrated: true, backend: false });
        }
      },

      upsertItem: (item) =>
        set((s) => {
          const byId = s.items.findIndex((i) => i.id === item.id);
          if (byId >= 0) {
            const copy = [...s.items];
            copy[byId] = item;
            return { items: copy };
          }
          // reconcile an optimistic placeholder with the same URL
          const optimistic = s.items.findIndex((i) => isOptimistic(i.id) && i.url && item.url && i.url === item.url);
          if (optimistic >= 0) {
            const copy = [...s.items];
            copy[optimistic] = item;
            return { items: copy };
          }
          return { items: [item, ...s.items] };
        }),
      upsertSkill: (skill) =>
        set((s) => {
          const idx = s.skills.findIndex((x) => x.id === skill.id);
          if (idx >= 0) {
            const copy = [...s.skills];
            copy[idx] = skill;
            return { skills: copy };
          }
          return { skills: [skill, ...s.skills] };
        }),

      ingestUrl: (rawUrl, opts = {}) => {
        const url = normalizeUrl(rawUrl);
        const existing = get().items.find((i) => i.url === url && !i.deletedAt);
        if (existing) return { item: existing, duplicate: true };
        const now = nowIso();
        const temp: Item = {
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
        set((s) => ({ items: [temp, ...s.items] }));

        if (get().backend) {
          api
            .createItem(url, { note: opts.note, tags: opts.tags, collectionIds: opts.collectionIds, source: opts.source })
            .then(({ item }) => {
              set((s) => ({ items: s.items.filter((i) => i.id !== temp.id) }));
              get().upsertItem(item);
            })
            .catch(() => get().patchItem(temp.id, { status: "ready" }));
        } else {
          window.setTimeout(() => get().patchItem(temp.id, enrichPatch(temp)), 900 + Math.random() * 800);
        }
        return { item: temp, duplicate: false };
      },

      patchItem: (id, patch) => {
        set((s) => ({ items: s.items.map((i) => (i.id === id ? { ...i, ...patch, updatedAt: nowIso() } : i)) }));
        if (get().backend && !isOptimistic(id)) {
          const body = apiItemPatch(patch);
          if (Object.keys(body).length) api.patchItem(id, body).catch(() => {});
        }
      },

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
        set((s) => ({ items: s.items.map((i) => (i.id === id ? { ...i, deletedAt: nowIso() } : i)) }));
        if (get().backend && !isOptimistic(id)) api.deleteItem(id).catch(() => {});
        return item;
      },
      restore: (id) => {
        set((s) => ({ items: s.items.map((i) => (i.id === id ? { ...i, deletedAt: undefined, updatedAt: nowIso() } : i)) }));
        if (get().backend && !isOptimistic(id)) api.restoreItem(id).catch(() => {});
      },
      purge: (id) => {
        const item = get().items.find((i) => i.id === id);
        set((s) => ({
          items: s.items.filter((i) => i.id !== id),
          skills: item?.skillId ? s.skills.filter((sk) => sk.id !== item.skillId) : s.skills,
        }));
        if (get().backend && !isOptimistic(id)) api.purgeItem(id).catch(() => {});
      },
      emptyTrash: () => {
        const trashed = get().items.filter((i) => i.deletedAt);
        const trashedSkillIds = trashed.filter((i) => i.skillId).map((i) => i.skillId);
        set((s) => ({ items: s.items.filter((i) => !i.deletedAt), skills: s.skills.filter((sk) => !trashedSkillIds.includes(sk.id)) }));
        if (get().backend) for (const i of trashed) if (!isOptimistic(i.id)) api.purgeItem(i.id).catch(() => {});
      },

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
        if (get().backend) {
          api.createPrompt({ title, body, tags }).then(({ item: real }) => {
            set((s) => ({ items: s.items.filter((i) => i.id !== item.id) }));
            get().upsertItem(real);
          }).catch(() => {});
        }
        return item;
      },
      usePrompt: (id) => {
        set((s) => ({ items: s.items.map((i) => (i.id === id && i.prompt ? { ...i, prompt: { ...i.prompt, usedCount: i.prompt.usedCount + 1 }, updatedAt: nowIso() } : i)) }));
        if (get().backend && !isOptimistic(id)) api.usePrompt(id).catch(() => {});
      },

      reviewSkill: (skillId) => {
        set((s) => ({ skills: s.skills.map((sk) => (sk.id === skillId ? { ...sk, trust: "reviewed", reviewedAt: nowIso(), updatedAt: nowIso() } : sk)) }));
        if (get().backend && !isOptimistic(skillId)) api.reviewSkill(skillId).then((r) => get().upsertSkill(r.skill)).catch(() => {});
      },
      toggleSkillPublic: (skillId) => {
        const sk = get().skills.find((x) => x.id === skillId);
        const next = !sk?.public;
        set((s) => ({ skills: s.skills.map((x) => (x.id === skillId ? { ...x, public: next, updatedAt: nowIso() } : x)) }));
        if (get().backend && !isOptimistic(skillId)) api.patchSkill(skillId, { public: next }).then((r) => get().upsertSkill(r.skill)).catch(() => {});
      },
      keepCopy: (skillId) => {
        set((s) => ({ skills: s.skills.map((sk) => (sk.id === skillId ? { ...sk, indexOnly: false, updatedAt: nowIso() } : sk)) }));
        if (get().backend && !isOptimistic(skillId)) api.keepCopy(skillId).then((r) => get().upsertSkill(r.skill)).catch(() => {});
      },

      saveSkillEdit: ({ skillId, name, content, tools, note }) => {
        const now = nowIso();
        const { data: fm, content: body } = parseFrontmatter(content);
        const skillName = name || (fm.name as string) || "new-skill";
        const files: SkillFile[] = [{ path: "SKILL.md", size: content.length, mime: "text/markdown", content }];
        const lint = lintSkill({ frontmatter: fm, body, files: ["SKILL.md"], folderName: skillName });
        const scan = scanSkill(new Map([["SKILL.md", content]]));
        const apiFiles = [{ path: "SKILL.md", mime: "text/markdown", content }];

        const existing = skillId ? get().skills.find((s) => s.id === skillId) : get().skills.find((s) => s.name === skillName);
        if (existing) {
          // Carry the previous version's supporting files through — the editor only touches SKILL.md (#2).
          const prevFiles = existing.versions.at(-1)?.files ?? [];
          const prevEntry = prevFiles.find((f) => /^SKILL\.md$/i.test(f.path));
          const prevOthers = prevFiles.filter((f) => !/^SKILL\.md$/i.test(f.path));
          const mergedFiles: SkillFile[] = [{ path: "SKILL.md", size: content.length, mime: "text/markdown", content }, ...prevOthers];

          // No-op when nothing actually changed, so we don't bump the version for a re-save (#10).
          const contentChanged = (prevEntry?.content ?? "") !== content;
          const toolsChanged = !!tools && (tools.length !== existing.tools.length || tools.some((t) => !existing.tools.includes(t)));
          const nameChanged = skillName !== existing.name;
          if (!contentChanged && !toolsChanged && !nameChanged && !note) {
            return get().items.find((i) => i.id === existing.itemId);
          }

          const nextN = existing.latest + 1;
          const version: SkillVersion = { n: nextN, createdAt: now, note, entry: "SKILL.md", files: mergedFiles, frontmatter: fm, totalSize: mergedFiles.reduce((a, f) => a + f.size, 0), lint, scan };
          const tookOver = existing.origin === "repo";
          const updated: Skill = {
            ...existing,
            name: skillName, // allow rename; the server versions by id, not name (#4/#5)
            latest: nextN,
            versions: [...existing.versions, version],
            displayName: (fm.name as string) ?? existing.displayName,
            description: (fm.description as string) ?? existing.description,
            tools: tools ?? existing.tools,
            origin: tookOver ? "authored" : existing.origin, // editing a copy makes it yours (§6.3)
            trust: tookOver ? "mine" : scan.risky && existing.trust === "reviewed" ? "unreviewed" : existing.trust,
            updatedAt: now,
          };
          set((s) => ({
            skills: s.skills.map((x) => (x.id === existing.id ? updated : x)),
            items: s.items.map((i) => (i.id === existing.itemId ? { ...i, title: updated.displayName, description: updated.description, updatedAt: now } : i)),
          }));
          if (get().backend && !isOptimistic(existing.id)) {
            // Version by id (survives rename), carrying supporting files as content-addressed refs.
            const apiFiles = [
              { path: "SKILL.md", mime: "text/markdown", content },
              ...prevOthers.map((f) => ({ path: f.path, mime: f.mime, sha256: f.sha256, size: f.size })),
            ];
            api.addSkillVersion(existing.id, { name: skillName, tools, note, files: apiFiles }).then((r) => get().upsertSkill(r.skill)).catch(() => {});
          }
          return get().items.find((i) => i.id === existing.itemId);
        }

        const itemId = uid("item");
        const newSkillId = uid("skill");
        const skill: Skill = {
          id: newSkillId,
          itemId,
          name: skillName,
          displayName: (fm.name as string) ?? skillName,
          description: (fm.description as string) ?? undefined,
          tools: tools ?? ["claude"],
          origin: "authored",
          trust: "mine",
          license: (fm.license as string) ?? undefined,
          latest: 1,
          usageCount: 0,
          createdAt: now,
          updatedAt: now,
          versions: [{ n: 1, createdAt: now, note, entry: "SKILL.md", files, frontmatter: fm, totalSize: content.length, lint, scan }],
        };
        const item: Item = { id: itemId, kind: "skill", skillId: newSkillId, title: skill.displayName, description: skill.description, tags: (tools ?? ["claude"]) as string[], collections: [], stage: "to-try", source: "web", status: "ready", createdAt: now, updatedAt: now };
        set((s) => ({ items: [item, ...s.items], skills: [skill, ...s.skills] }));
        if (get().backend) {
          api
            .createSkill({ name: skillName, tools, note, files: apiFiles })
            .then((r) => {
              set((s) => ({ items: s.items.filter((i) => i.id !== itemId), skills: s.skills.filter((sk) => sk.id !== newSkillId) }));
              get().upsertSkill(r.skill);
            })
            .catch(() => {});
        }
        return item;
      },

      extractLinks: async (itemId) => {
        const item = get().items.find((i) => i.id === itemId);
        if (get().backend && item && !isOptimistic(itemId)) {
          // New items stream back over SSE (item.created); return the tally for the toast.
          return api.extractLinks(itemId);
        }
        // Mock mode: parse GitHub links out of the README and ingest each locally.
        const readme = (item && (get().readmes[itemId] ?? item.github?.readme)) ?? "";
        const label = item?.title ?? "list";
        const links = [...new Set((readme.match(/https?:\/\/github\.com\/[\w.-]+\/[\w.-]+/gi) ?? []).map((l) => l.replace(/[).,]+$/, "")))];
        let saved = 0;
        let skipped = 0;
        for (const url of links) {
          const { duplicate } = get().ingestUrl(url, { source: "import", tags: [label] });
          duplicate ? skipped++ : saved++;
        }
        return { found: links.length, saved, skipped };
      },
      snapshotSkills: async (itemId, dirs) => {
        if (get().backend && !isOptimistic(itemId)) {
          const { copied } = await api.snapshotSkills(itemId, dirs);
          // Refresh skills + the item so newly-copied skills and snapshotted flags appear.
          try {
            const [skills, items] = await Promise.all([api.listSkills(), api.listItems()]);
            set({ skills: skills.skills });
            const fresh = items.items.find((i) => i.id === itemId);
            if (fresh) get().upsertItem(fresh);
          } catch {
            /* the copy still succeeded; UI refreshes on next hydrate */
          }
          return copied;
        }
        // Mock mode: flip the matching skillIndex entries to snapshotted.
        const item = get().items.find((i) => i.id === itemId);
        const idx = item?.github?.skillIndex ?? [];
        const targets = idx.filter((e) => (dirs ? dirs.includes(e.path) : !e.snapshotted));
        if (item?.github && targets.length) {
          const nextIndex = idx.map((e) => (targets.some((t) => t.path === e.path) ? { ...e, snapshotted: true } : e));
          const copiedCount = nextIndex.filter((e) => e.snapshotted).length;
          get().patchItem(itemId, { github: { ...item.github, skillIndex: nextIndex, copiedCount } });
        }
        return targets.length;
      },

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
                { n: 1, createdAt: now, entry: entry?.path ?? "SKILL.md", files: d.files, frontmatter: fm, totalSize: d.files.reduce((a, f) => a + f.size, 0), lint: d.lint, scan: d.scan },
              ],
            };
            const item: Item = { id: itemId, kind: "skill", skillId, title: skill.displayName, description: skill.description, tags: ["claude"], collections: [], stage: "to-try", source, status: "ready", createdAt: now, updatedAt: now };
            set((s) => ({ items: [item, ...s.items], skills: [skill, ...s.skills] }));
            created.push(item);
            if (get().backend) {
              // Upload bytes straight to storage, then finalize with content-addressed refs (§6.2).
              const blobs = d.blobs;
              const finalize = blobs?.length
                ? uploadObjects(blobs).then((refs) => api.createSkill({ name: d.name, tools: skill.tools, files: refs }))
                : api.createSkill({ name: d.name, tools: skill.tools, files: d.files.map((f) => ({ path: f.path, mime: f.mime, content: f.content })) });
              finalize
                .then((r) => {
                  set((s) => ({ items: s.items.filter((i) => i.id !== itemId), skills: s.skills.filter((sk) => sk.id !== skillId) }));
                  get().upsertSkill(r.skill);
                })
                .catch(() => {});
            }
          } else {
            const item: Item = { id: uid("item"), kind: "file", title: d.path, description: `Uploaded file (${d.mime}).`, tags: [], collections: [], stage: "to-try", source, status: "ready", fileObject: { path: d.path, size: d.size, mime: d.mime }, createdAt: now, updatedAt: now };
            set((s) => ({ items: [item, ...s.items] }));
            created.push(item);
            if (get().backend) {
              // Upload bytes straight to storage, then finalize with a content-addressed ref (§6.2).
              const finalize = d.blob
                ? uploadObjects([{ path: d.path, mime: d.mime, blob: d.blob }]).then(([ref]) => api.createFile({ path: d.path, mime: d.mime, sha256: ref!.sha256, size: ref!.size }))
                : api.createFile({ path: d.path, mime: d.mime, content: "" });
              finalize
                .then(({ item: real }) => {
                  set((s) => ({ items: s.items.filter((i) => i.id !== item.id) }));
                  get().upsertItem(real);
                })
                .catch(() => {});
            }
          }
        }
        return created;
      },

      createCollection: (name) => {
        const col: Collection = { id: uid("col"), name, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""), order: get().collections.length + 1, color: ["#4f46e5", "#14b8a6", "#f59e0b", "#ec4899", "#8b5cf6"][get().collections.length % 5] };
        set((s) => ({ collections: [...s.collections, col] }));
        if (get().backend) {
          api.createCollection(name).then(({ collection }) => set((s) => ({ collections: s.collections.map((c) => (c.id === col.id ? collection : c)) }))).catch(() => {});
        }
        return col;
      },
      toggleItemCollection: (itemId, collectionId) => {
        const cur = get().items.find((i) => i.id === itemId);
        if (!cur) return;
        const has = cur.collections.includes(collectionId);
        const next = has ? cur.collections.filter((c) => c !== collectionId) : [...cur.collections, collectionId];
        get().patchItem(itemId, { collections: next });
      },

      renameTag: (from, to) => {
        set((s) => ({ items: s.items.map((i) => (i.tags.includes(from) ? { ...i, tags: [...new Set(i.tags.map((t) => (t === from ? to : t)))] } : i)) }));
        if (get().backend) api.renameTag(from, to).catch(() => {});
      },
      deleteTag: (tag) => {
        set((s) => ({ items: s.items.map((i) => (i.tags.includes(tag) ? { ...i, tags: i.tags.filter((t) => t !== tag) } : i)) }));
        if (get().backend) api.deleteTag(tag).catch(() => {});
      },
      mergeTags: (from, to) => {
        set((s) => ({ items: s.items.map((i) => (i.tags.some((t) => from.includes(t)) ? { ...i, tags: [...new Set(i.tags.map((t) => (from.includes(t) ? to : t)))] } : i)) }));
        if (get().backend) api.mergeTags(from, to).catch(() => {});
      },

      setTheme: (theme) => set((s) => ({ user: { ...s.user, settings: { ...s.user.settings, theme } } })),
      resetVault: () => {
        if (backendEnabled) {
          set({ hydrated: false });
          void get().initBackend();
          return;
        }
        set({ user: seedUser(), items: seedItems(), skills: seedSkills(), collections: seedCollections(), readmes: SEED_READMES, filePreviews: SEED_FILE_PREVIEWS });
      },
    }),
    {
      name: "kosh.data.v1",
      // In backend mode nothing is persisted locally (server is source of truth;
      // theme lives in its own key). In mock mode the whole vault persists.
      partialize: (s) =>
        backendEnabled
          ? {}
          : { user: s.user, items: s.items, skills: s.skills, collections: s.collections, readmes: s.readmes, filePreviews: s.filePreviews },
    },
  ),
);
