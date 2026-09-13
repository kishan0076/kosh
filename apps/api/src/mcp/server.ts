import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { extractVariables, renderPrompt, searchItems } from "@kosh/shared";
import { getStore } from "../db/index.js";
import { requireUser } from "../auth/middleware.js";
import { ingest } from "../modules/ingest.js";
import { createSkillVersion, type IncomingFile } from "../modules/skills.js";

const json = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] });

/** Build a fresh MCP server bound to a user (stateless per request). */
function buildServer(userId: string): McpServer {
  const server = new McpServer({ name: "kosh", version: "0.1.0" });
  const store = getStore();

  server.registerTool(
    "save_link",
    { description: "Save a link (or GitHub repo) to the Kosh vault.", inputSchema: { url: z.string(), note: z.string().optional(), tags: z.array(z.string()).optional() } },
    async ({ url, note, tags }) => {
      const { item, duplicate } = await ingest(userId, url, { note, tags, source: "mcp" });
      return json({ id: item.id, url: item.url, duplicate, message: duplicate ? "Already saved." : "Saving… enrichment runs in the background." });
    },
  );

  server.registerTool(
    "search_vault",
    { description: "Search links, skills, prompts and files.", inputSchema: { query: z.string(), kind: z.string().optional(), stage: z.string().optional(), limit: z.number().optional() } },
    async ({ query, kind, stage, limit }) => {
      // Fold kind/stage into the shared ranker's query grammar so ranking + filters agree with the web.
      const full = [query, kind ? `kind:${kind}` : "", stage ? `stage:${stage}` : ""].filter(Boolean).join(" ");
      const items = searchItems(await store.items.find({ userId, deletedAt: null }), full, { limit: limit ?? 20 }).map((h) => ({
        id: h.item.id,
        kind: h.item.kind,
        title: h.item.title,
        url: h.item.url,
        stage: h.item.stage,
        tags: h.item.tags,
      }));
      return json({ results: items });
    },
  );

  server.registerTool(
    "search_repos",
    { description: "Search your saved GitHub repo cards by kind/keyword.", inputSchema: { query: z.string().optional(), kind: z.string().optional() } },
    async ({ query, kind }) => {
      const q = (query ?? "").toLowerCase();
      const repos = (await store.items.find({ userId, kind: "link", deletedAt: null }))
        .filter((i) => i.linkType === "repo")
        .filter((i) => (kind ? i.github?.repoKind === kind : true))
        .filter((i) => !q || i.title?.toLowerCase().includes(q) || i.description?.toLowerCase().includes(q))
        .map((i) => ({ title: i.title, url: i.url, repoKind: i.github?.repoKind, stars: i.github?.stars, install: i.github?.install?.command, skillsInside: i.github?.skillIndex?.length ?? 0 }));
      return json({ repos });
    },
  );

  server.registerTool(
    "list_skills",
    { description: "List your skills with trust, version and health.", inputSchema: { tool: z.string().optional(), trust: z.string().optional() } },
    async ({ tool, trust }) => {
      const skills = (await store.skills.find({ userId, deletedAt: null }))
        .filter((s) => (tool ? s.tools.includes(tool as never) : true) && (trust ? s.trust === trust : true))
        .map((s) => ({ name: s.name, version: s.latest, trust: s.trust, tools: s.tools, license: s.license, risky: s.versions.at(-1)?.scan.risky ?? false }));
      return json({ skills });
    },
  );

  server.registerTool(
    "get_skill",
    { description: "Get a skill's files to install. Refuses unreviewed skills unless allow_unreviewed is true.", inputSchema: { name: z.string(), version: z.number().optional(), allow_unreviewed: z.boolean().optional() } },
    async ({ name, version, allow_unreviewed }) => {
      const skill = await store.skills.findOne({ userId, name, deletedAt: null });
      if (!skill) return json({ error: `No skill named ${name}.` });
      if (skill.trust === "unreviewed" && !allow_unreviewed) {
        return json({ error: `${name} is unreviewed (from ${skill.source?.owner ?? "a repo"}). Review it in Kosh or pass allow_unreviewed: true.`, findings: skill.versions.at(-1)?.scan.findings });
      }
      const v = skill.versions.find((x) => x.n === version) ?? skill.versions.at(-1)!;
      return json({
        name: skill.name,
        version: v.n,
        license: skill.license,
        instructions: `Write these files to .claude/skills/${skill.name}/ (or ~/.claude/skills/${skill.name}/) to install.`,
        files: v.files.map((f) => ({ path: f.path, content: f.content ?? "" })),
      });
    },
  );

  server.registerTool(
    "save_skill",
    { description: "Save a skill you just wrote to Kosh (trust: mine).", inputSchema: { name: z.string(), files: z.array(z.object({ path: z.string(), content: z.string() })), tools: z.array(z.string()).optional(), note: z.string().optional() } },
    async ({ name, files, tools, note }) => {
      const incoming: IncomingFile[] = files.map((f) => ({ path: f.path, mime: "text/markdown", content: f.content }));
      const { skill } = await createSkillVersion(userId, incoming, { origin: "authored", itemSource: "mcp", name, tools: tools as never, note, trust: "mine" });
      return json({ name: skill.name, version: skill.latest, message: "Saved to Kosh." });
    },
  );

  server.registerTool(
    "save_prompt",
    { description: "Save a reusable prompt (supports {{variables}}).", inputSchema: { title: z.string(), body: z.string(), tags: z.array(z.string()).optional() } },
    async ({ title, body, tags }) => {
      const now = new Date().toISOString();
      const item = await store.items.create({
        userId,
        kind: "prompt",
        title,
        description: body.slice(0, 140),
        tags: tags ?? [],
        collections: [],
        stage: "to-try",
        source: "mcp",
        status: "ready",
        prompt: { body, variables: extractVariables(body).map((name) => ({ name })), usedCount: 0 },
        createdAt: now,
        updatedAt: now,
      } as never);
      return json({ id: item.id, title, message: "Prompt saved." });
    },
  );

  server.registerTool(
    "get_prompt",
    { description: "Get a prompt's body (optionally filled with values for its {{variables}}).", inputSchema: { title: z.string(), values: z.record(z.string(), z.string()).optional() } },
    async ({ title, values }) => {
      const q = title.toLowerCase();
      const item = (await store.items.find({ userId, kind: "prompt", deletedAt: null })).find((i) => i.title?.toLowerCase() === q || i.title?.toLowerCase().includes(q));
      if (!item?.prompt) return json({ error: `No prompt matching "${title}".` });
      const rendered = renderPrompt(item.prompt.body, values ?? {});
      await store.items.updateById(item.id, { prompt: { ...item.prompt, usedCount: item.prompt.usedCount + 1 } });
      return json({ title: item.title, variables: item.prompt.variables, rendered });
    },
  );

  server.registerTool("list_collections", { description: "List your collections.", inputSchema: {} }, async () => {
    const cols = await store.collections.find({ userId });
    return json({ collections: cols.map((c) => ({ name: c.name, slug: c.slug })) });
  });

  return server;
}

export const mcpRouter: Router = Router();

// Streamable HTTP with per-session transports (the pattern real MCP clients use).
const transports = new Map<string, StreamableHTTPServerTransport>();

mcpRouter.post("/mcp", async (req, res) => {
  const userId = requireUser(req);
  const sid = req.header("mcp-session-id");
  let transport = sid ? transports.get(sid) : undefined;

  if (!transport) {
    if (!isInitializeRequest(req.body)) {
      res.status(400).json({ jsonrpc: "2.0", error: { code: -32000, message: "No valid session; send an initialize request first." }, id: null });
      return;
    }
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        transports.set(id, transport!);
      },
    });
    transport.onclose = () => {
      if (transport!.sessionId) transports.delete(transport!.sessionId);
    };
    await buildServer(userId).connect(transport);
  }
  await transport.handleRequest(req, res, req.body);
});

// Server→client SSE stream and session teardown.
const bySession = async (req: Parameters<typeof requireUser>[0], res: import("express").Response) => {
  requireUser(req);
  const sid = (req as { header(n: string): string | undefined }).header("mcp-session-id");
  const transport = sid ? transports.get(sid) : undefined;
  if (!transport) {
    res.status(400).send("Invalid or missing session id");
    return;
  }
  await transport.handleRequest(req as never, res);
};
mcpRouter.get("/mcp", (req, res) => void bySession(req, res));
mcpRouter.delete("/mcp", (req, res) => void bySession(req, res));
