import { Router } from "express";
import { z } from "zod";
import archiver from "archiver";
import { getStore, type ServerSkill } from "../db/index.js";
import { ah, badRequest, notFound } from "../errors.js";
import { requireUser, requireWrite } from "../auth/middleware.js";
import { createSkillVersion, toClientSkill, type IncomingFile } from "../modules/skills.js";
import { getObject } from "../storage/objects.js";

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
    .array(z.object({ path: z.string().min(1), mime: z.string().default("text/plain"), content: z.string().optional(), bytesBase64: z.string().optional() }))
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
      if ((e as Error).message === "NO_SKILL_MD") throw badRequest("NO_SKILL_MD", "No SKILL.md at the top level.");
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
