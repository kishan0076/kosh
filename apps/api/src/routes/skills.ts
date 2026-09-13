import { Router } from "express";
import { z } from "zod";
import archiver from "archiver";
import { getStore, type ServerSkill } from "../db/index.js";
import { ah, badRequest, notFound } from "../errors.js";
import { requireUser, requireWrite } from "../auth/middleware.js";
import { addSkillVersion, createSkillVersion, toClientSkill, type IncomingFile } from "../modules/skills.js";
import { getObject } from "../storage/objects.js";
import { enrichGithub } from "../integrations/github.js";
import { snapshotRepoSkills } from "../modules/snapshot.js";
import { decryptSecret } from "../auth/crypto.js";

export const skillsRouter: Router = Router();
const nowIso = () => new Date().toISOString();

async function ownedSkill(userId: string, id: string): Promise<ServerSkill> {
  const s = await getStore().skills.findById(id);
  if (!s || s.userId !== userId) throw notFound("Skill not found.");
  return s;
}

skillsRouter.get(
  "/skills",
  ah(async (req, res) => {
    const uid = requireUser(req);
    const tool = req.query.tool as string | undefined;
    const trust = req.query.trust as string | undefined;
    const origin = req.query.origin as string | undefined;
    const q = String(req.query.q ?? "").toLowerCase();
    let skills = await getStore().skills.find({ userId: uid, deletedAt: null }, { sort: { updatedAt: -1 } });
    skills = skills.filter((s) => {
      if (tool && !s.tools.includes(tool as ServerSkill["tools"][number])) return false;
      if (trust && s.trust !== trust) return false;
      if (origin && s.origin !== origin) return false;
      if (q && !(s.name.toLowerCase().includes(q) || s.description?.toLowerCase().includes(q) || s.searchText?.toLowerCase().includes(q))) return false;
      return true;
    });
    res.json({ skills: skills.map(toClientSkill) });
  }),
);

skillsRouter.get(
  "/skills/:id",
  ah(async (req, res) => {
    const uid = requireUser(req);
    res.json({ skill: toClientSkill(await ownedSkill(uid, String(req.params.id))) });
  }),
);

const createSchema = z.object({
  name: z.string().max(64).optional(),
  note: z.string().max(500).optional(),
  tools: z.array(z.enum(["claude", "codex", "cursor", "gemini", "generic"])).optional(),
  files: z
    .array(
      z.object({
        path: z.string().min(1),
        mime: z.string().default("text/plain"),
        content: z.string().optional(),
        bytesBase64: z.string().optional(),
        sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
        size: z.number().int().min(0).optional(),
      }),
    )
    .min(1),
});

skillsRouter.post(
  "/skills",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const body = createSchema.parse(req.body);
    try {
      const { skill, item, changed } = await createSkillVersion(uid, body.files as IncomingFile[], {
        origin: "authored",
        itemSource: "web",
        name: body.name,
        tools: body.tools,
        note: body.note,
        trust: "mine",
      });
      res.status(201).json({ skill: toClientSkill(skill), itemId: item?.id, changed });
    } catch (e) {
      const msg = (e as Error).message;
      if (msg === "NO_SKILL_MD") throw badRequest("NO_SKILL_MD", "No SKILL.md at the top level.");
      if (msg === "OBJECT_MISSING") throw badRequest("OBJECT_MISSING", "An uploaded file is missing — re-run the upload.");
      if (msg === "HASH_MISMATCH") throw badRequest("HASH_MISMATCH", "An uploaded file failed integrity verification.");
      throw e;
    }
  }),
);

/* copy-from-repo — powers `kosh add owner/repo:path` (§6.9): snapshot one skill dir
 * from a repo already saved in the vault, then return its name so the CLI can install it. */
skillsRouter.post(
  "/skills/copy-from-repo",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const { owner, repo, path } = z
      .object({ owner: z.string().min(1), repo: z.string().min(1), path: z.string().default("") })
      .parse(req.body);
    const items = await getStore().items.find({ userId: uid, kind: "link", deletedAt: null });
    const item = items.find(
      (i) => i.github?.owner?.toLowerCase() === owner.toLowerCase() && i.github?.repo?.toLowerCase() === repo.toLowerCase(),
    );
    if (!item?.github) throw notFound(`Save ${owner}/${repo} in Kosh first, then copy a skill from it.`);

    const user = await getStore().users.findById(uid);
    const token = decryptSecret(user?.githubToken) ?? null;
    const r = await enrichGithub(owner, repo, { token, prevSkillIndex: item.github.skillIndex, etag: undefined });
    if (!("ok" in r) || !r.ok) {
      res.status(502).json({ error: { code: "GITHUB_UNREACHABLE", message: "Couldn't reach GitHub to copy this skill." } });
      return;
    }
    const copied = await snapshotRepoSkills(item, r.data, { token, dirs: [path] });
    const skill = await getStore().skills.findOne({ userId: uid, "source.itemId": item.id, "source.path": path, deletedAt: null });
    if (!skill) throw notFound(`No skill found at ${owner}/${repo}:${path || "(root)"}.`);
    res.json({ copied, skill: { name: skill.name, latest: skill.latest, trust: skill.trust } });
  }),
);

/* add a version to an existing skill by id — the in-app editor (§6.8). Handles rename,
 * tool/changelog edits, and preserves multi-file skills. */
skillsRouter.post(
  "/skills/:id/versions",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const body = createSchema.parse(req.body);
    try {
      const { skill, item, changed } = await addSkillVersion(uid, String(req.params.id), body.files as IncomingFile[], {
        name: body.name,
        tools: body.tools,
        note: body.note,
      });
      res.status(changed ? 201 : 200).json({ skill: toClientSkill(skill), itemId: item?.id, changed });
    } catch (e) {
      const msg = (e as Error).message;
      if (msg === "SKILL_NOT_FOUND") throw notFound("Skill not found.");
      if (msg === "NO_SKILL_MD") throw badRequest("NO_SKILL_MD", "No SKILL.md at the top level.");
      if (msg === "NAME_TAKEN") throw badRequest("NAME_TAKEN", "A skill with that name already exists.");
      if (msg === "OBJECT_MISSING") throw badRequest("OBJECT_MISSING", "An uploaded file is missing — re-run the upload.");
      if (msg === "HASH_MISMATCH") throw badRequest("HASH_MISMATCH", "An uploaded file failed integrity verification.");
      throw e;
    }
  }),
);

skillsRouter.post(
  "/skills/:id/review",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const s = await ownedSkill(uid, String(req.params.id));
    const updated = await getStore().skills.updateById(s.id, { trust: "reviewed", reviewedAt: nowIso(), updatedAt: nowIso() });
    res.json({ skill: toClientSkill(updated!) });
  }),
);

skillsRouter.delete(
  "/skills/:id",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const s = await ownedSkill(uid, String(req.params.id));
    await getStore().skills.updateById(s.id, { deletedAt: nowIso(), updatedAt: nowIso() });
    await getStore().items.updateById(s.itemId, { deletedAt: nowIso(), updatedAt: nowIso() });
    res.json({ ok: true });
  }),
);

skillsRouter.post(
  "/skills/:id/keep-copy",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const s = await ownedSkill(uid, String(req.params.id));
    const updated = await getStore().skills.updateById(s.id, { indexOnly: false, updatedAt: nowIso() });
    res.json({ skill: toClientSkill(updated!) });
  }),
);

skillsRouter.patch(
  "/skills/:id",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const s = await ownedSkill(uid, String(req.params.id));
    const body = z
      .object({
        public: z.boolean().optional(),
        displayName: z.string().max(120).optional(),
        tools: z.array(z.enum(["claude", "codex", "cursor", "gemini", "generic"])).optional(),
      })
      .parse(req.body);
    const patch: Partial<ServerSkill> = { updatedAt: nowIso() };
    if (body.public !== undefined) {
      patch.public = body.public;
      if (body.public && !s.publicSlug) patch.publicSlug = s.name;
    }
    if (body.displayName !== undefined) patch.displayName = body.displayName;
    if (body.tools !== undefined) patch.tools = body.tools;
    const updated = await getStore().skills.updateById(s.id, patch);
    res.json({ skill: toClientSkill(updated!) });
  }),
);

async function resolveSkill(userId: string, key: string): Promise<ServerSkill> {
  const byId = await getStore().skills.findById(key);
  if (byId && byId.userId === userId) return byId;
  const byName = await getStore().skills.findOne({ userId, name: key, deletedAt: null });
  if (byName) return byName;
  throw notFound("Skill not found.");
}

/* manifest — powers the CLI + MCP (resolves by id or name) */
skillsRouter.get(
  "/skills/:id/manifest",
  ah(async (req, res) => {
    const uid = requireUser(req);
    const s = await resolveSkill(uid, String(req.params.id));
    const v = s.versions.find((x) => x.n === Number(req.query.v)) ?? s.versions.at(-1)!;
    res.json({
      name: s.name,
      version: v.n,
      trust: s.trust,
      license: s.license,
      source: s.source?.owner ? `${s.source.owner}/${s.source.repo}` : undefined,
      scan: v.scan,
      files: v.files.map((f) => ({ path: f.path, size: f.size, mime: f.mime, content: f.content })),
    });
  }),
);

skillsRouter.post(
  "/skills/:id/installed",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const s = await resolveSkill(uid, String(req.params.id));
    await getStore().skills.updateById(s.id, { usageCount: (s.usageCount ?? 0) + 1, lastUsedAt: nowIso() });
    res.json({ ok: true });
  }),
);

/* raw file (streams from object store; falls back to inline content) */
skillsRouter.get(
  "/skills/:id/files/{*path}",
  ah(async (req, res) => {
    const uid = requireUser(req);
    const s = await ownedSkill(uid, String(req.params.id));
    const version = s.versions.at(-1)!;
    const rel = Array.isArray(req.params.path) ? req.params.path.join("/") : String(req.params.path ?? "");
    const file = version.files.find((f) => f.path === rel);
    if (!file) throw notFound("File not found.");
    const buf = file.sha256 ? await getObject(uid, file.sha256) : null;
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${file.path.split("/").pop()}"`);
    res.send(buf ?? Buffer.from(file.content ?? "", "utf8"));
  }),
);

/* zip download */
skillsRouter.get(
  "/skills/:id/zip",
  ah(async (req, res) => {
    const uid = requireUser(req);
    const s = await ownedSkill(uid, String(req.params.id));
    const version = s.versions.at(-1)!;
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${s.name}.zip"`);
    const archive = archiver("zip", { zlib: { level: 9 } });
    archive.pipe(res);
    for (const f of version.files) {
      const buf = f.sha256 ? await getObject(uid, f.sha256) : null;
      archive.append(buf ?? Buffer.from(f.content ?? "", "utf8"), { name: `${s.name}/${f.path}` });
    }
    await archive.finalize();
  }),
);
