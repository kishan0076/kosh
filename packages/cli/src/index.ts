#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { Command } from "commander";
import { DEFAULT_IGNORES, isValidRepoName, planRepoUpload, sanitizeRepoName, scanSecrets } from "@kosh/shared";

interface Config {
  apiUrl: string;
  apiKey: string;
}
const CONFIG_DIR = join(homedir(), ".config", "kosh");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

function loadConfig(): Config {
  const apiUrl = process.env.KOSH_API_URL;
  const apiKey = process.env.KOSH_API_KEY;
  if (apiUrl && apiKey) return { apiUrl: apiUrl.replace(/\/$/, ""), apiKey };
  if (existsSync(CONFIG_FILE)) {
    const c = JSON.parse(readFileSync(CONFIG_FILE, "utf8"));
    return { apiUrl: c.apiUrl.replace(/\/$/, ""), apiKey: c.apiKey };
  }
  fail("Not logged in. Run: kosh login --api-url <url> --key <ksh_...>");
}

function fail(msg: string): never {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

async function api<T>(path: string, cfg: Config, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${cfg.apiUrl}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    let m = `${res.status} ${res.statusText}`;
    try {
      m = (await res.json())?.error?.message ?? m;
    } catch {
      /* ignore */
    }
    fail(m);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

const MIME: Record<string, string> = { md: "text/markdown", py: "text/x-python", js: "text/javascript", ts: "text/typescript", json: "application/json", sh: "text/x-shellscript", txt: "text/plain", yml: "text/yaml", yaml: "text/yaml" };
const mimeOf = (p: string) => MIME[p.split(".").pop()?.toLowerCase() ?? ""] ?? "text/plain";
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

function resolveTarget(to: string, name: string): string {
  if (to === "claude") return join(homedir(), ".claude", "skills", name);
  if (to === "project") return join(process.cwd(), ".claude", "skills", name);
  if (to === "agents") return join(process.cwd(), ".agents", "skills", name);
  return join(to.startsWith("~") ? to.replace("~", homedir()) : to, name);
}

/** Walk every file under a folder (skipping heavy/ignored dirs early), with posix paths + sizes. */
async function walkProject(root: string): Promise<{ path: string; size: number }[]> {
  const out: { path: string; size: number }[] = [];
  async function walk(d: string) {
    for (const e of await readdir(d, { withFileTypes: true })) {
      if (DEFAULT_IGNORES.includes(e.name)) continue;
      const full = join(d, e.name);
      if (e.isDirectory()) await walk(full);
      else if (e.isFile()) out.push({ path: relative(root, full).replace(/\\/g, "/"), size: (await stat(full)).size });
    }
  }
  await walk(root);
  return out;
}

/** utf-8 for text, base64 for binary (a NUL byte is a reliable binary tell). */
function encodeFile(buf: Buffer): { content: string; encoding: "utf-8" | "base64" } {
  return buf.includes(0) ? { content: buf.toString("base64"), encoding: "base64" } : { content: buf.toString("utf8"), encoding: "utf-8" };
}

async function readSkillDir(dir: string): Promise<{ path: string; mime: string; content: string }[]> {
  const files: { path: string; mime: string; content: string }[] = [];
  async function walk(d: string) {
    for (const e of await readdir(d, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      const full = join(d, e.name);
      if (e.isDirectory()) await walk(full);
      else files.push({ path: relative(dir, full).replace(/\\/g, "/"), mime: mimeOf(e.name), content: await readFile(full, "utf8") });
    }
  }
  await walk(dir);
  return files;
}

const program = new Command();
program.name("kosh").description("Kosh — your AI toolbox, from the terminal").version("0.1.0");

program
  .command("login")
  .requiredOption("--api-url <url>", "Kosh API base, e.g. http://localhost:8787/api")
  .requiredOption("--key <key>", "API key (ksh_...)")
  .action((opts) => {
    mkdirSync(CONFIG_DIR, { recursive: true });
    writeFileSync(CONFIG_FILE, JSON.stringify({ apiUrl: opts.apiUrl, apiKey: opts.key }, null, 2));
    console.log(`✓ Saved credentials to ${CONFIG_FILE}`);
  });

program
  .command("list")
  .description("List your skills")
  .option("--tool <tool>", "Filter by tool")
  .action(async (opts) => {
    const cfg = loadConfig();
    const { skills } = await api<{ skills: { name: string; latest: number; trust: string; tools: string[]; license?: string }[] }>(`/skills${opts.tool ? `?tool=${opts.tool}` : ""}`, cfg);
    if (!skills.length) return console.log("No skills yet.");
    for (const s of skills) console.log(`  ${s.name}  v${s.latest}  ${s.trust}  ${s.tools.join(",")}${s.license ? `  (${s.license})` : ""}`);
  });

program
  .command("add <name>")
  .description("Install a skill into an agent's skills folder")
  .option("--to <target>", "claude | project | agents | <dir>", "claude")
  .option("--version <n>", "Version number")
  .option("--yes", "Install even if unreviewed")
  .action(async (name, opts) => {
    const cfg = loadConfig();
    // `kosh add owner/repo:path` — copy an indexed skill from a saved repo, then install it. (§6.9)
    if (/^[\w.-]+\/[\w.-]+:/.test(name)) {
      const idx = name.indexOf(":");
      const [owner, repo] = name.slice(0, idx).split("/");
      const path = name.slice(idx + 1);
      const copied = await api<{ copied: number; skill: { name: string } }>("/skills/copy-from-repo", cfg, {
        method: "POST",
        body: JSON.stringify({ owner, repo, path }),
      });
      console.log(`✓ Copied ${owner}/${repo}:${path || "(root)"} → ${copied.skill.name}`);
      name = copied.skill.name;
    }
    type Manifest = { name: string; version: number; trust: string; license?: string; source?: string; files: { path: string; content?: string }[] };
    const m = await api<Manifest>(`/skills/${encodeURIComponent(name)}/manifest${opts.version ? `?v=${opts.version}` : ""}`, cfg);
    if (m.trust === "unreviewed" && !opts.yes) {
      fail(`${m.name} is unreviewed (copied from ${m.source ?? "a repo"}). Open it in Kosh, read it, press "Mark reviewed" — or re-run with --yes.`);
    }
    const dest = resolveTarget(opts.to, m.name);
    for (const f of m.files) {
      const target = join(dest, f.path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, f.content ?? "");
    }
    await api(`/skills/${encodeURIComponent(name)}/installed`, cfg, { method: "POST" }).catch(() => {});
    console.log(`✓ Installed ${m.name} v${m.version} → ${dest}${m.license ? `  (${m.license})` : ""}`);
  });

program
  .command("push <dir>")
  .description("Upload a local skill folder")
  .option("--name <name>", "Skill name (defaults to frontmatter/folder)")
  .option("--tools <tools>", "Comma-separated tools", "claude")
  .option("--note <note>", "Version note")
  .action(async (dir, opts) => {
    const cfg = loadConfig();
    if (!existsSync(join(dir, "SKILL.md"))) fail(`No SKILL.md in ${dir}`);
    const files = await readSkillDir(dir);
    const { skill } = await api<{ skill: { name: string; latest: number } }>("/skills", cfg, {
      method: "POST",
      body: JSON.stringify({ name: opts.name, tools: opts.tools.split(","), note: opts.note, files }),
    });
    console.log(`✓ Pushed ${skill.name} v${skill.latest}`);
  });

program
  .command("status")
  .description("Compare local ~/.claude/skills with the vault by hash")
  .action(async () => {
    const cfg = loadConfig();
    const base = join(homedir(), ".claude", "skills");
    if (!existsSync(base)) return console.log("No local skills at ~/.claude/skills");
    for (const e of await readdir(base, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const local = await readSkillDir(join(base, e.name));
      const localHash = sha256(local.map((f) => `${f.path}:${sha256(f.content)}`).sort().join("|"));
      try {
        const m = await api<{ files: { path: string; content?: string }[] }>(`/skills/${encodeURIComponent(e.name)}/manifest`, cfg);
        const vaultHash = sha256(m.files.map((f) => `${f.path}:${sha256(f.content ?? "")}`).sort().join("|"));
        console.log(`  ${e.name}: ${localHash === vaultHash ? "in sync" : "differs"}`);
      } catch {
        console.log(`  ${e.name}: not in vault`);
      }
    }
  });

program
  .command("sync")
  .description("Pull all your (copied) skills into ~/.claude/skills")
  .option("--force", "Overwrite folders that differ locally")
  .action(async (opts) => {
    const cfg = loadConfig();
    const { skills } = await api<{ skills: { name: string; indexOnly?: boolean }[] }>("/skills", cfg);
    const base = join(homedir(), ".claude", "skills");
    let synced = 0;
    for (const s of skills) {
      if (s.indexOnly) continue;
      const m = await api<{ name: string; files: { path: string; content?: string }[] }>(`/skills/${encodeURIComponent(s.name)}/manifest`, cfg);
      const dest = join(base, s.name);
      if (existsSync(dest) && !opts.force) {
        const local = await readSkillDir(dest);
        const localHash = sha256(local.map((f) => `${f.path}:${sha256(f.content)}`).sort().join("|"));
        const vaultHash = sha256(m.files.map((f) => `${f.path}:${sha256(f.content ?? "")}`).sort().join("|"));
        if (localHash !== vaultHash) {
          console.log(`  ~ ${s.name} (local differs — skipped; use --force)`);
          continue;
        }
      }
      for (const f of m.files) {
        const target = join(dest, f.path);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, f.content ?? "");
      }
      console.log(`  ✓ ${s.name}`);
      synced++;
    }
    console.log(`Synced ${synced} skill(s) → ${base}`);
  });

program
  .command("import-local")
  .description("Push skills already on disk into the vault (trust: mine)")
  .action(async () => {
    const cfg = loadConfig();
    const roots = [join(homedir(), ".claude", "skills"), join(process.cwd(), ".claude", "skills"), join(process.cwd(), ".agents", "skills")];
    let count = 0;
    for (const root of roots) {
      if (!existsSync(root)) continue;
      for (const e of await readdir(root, { withFileTypes: true })) {
        const dir = join(root, e.name);
        if (!e.isDirectory() || !existsSync(join(dir, "SKILL.md"))) continue;
        const files = await readSkillDir(dir);
        await api("/skills", cfg, { method: "POST", body: JSON.stringify({ name: e.name, files }) });
        console.log(`  ✓ ${e.name}`);
        count++;
      }
    }
    console.log(count ? `Imported ${count} skill(s).` : "No local skills found.");
  });

program
  .command("publish <dir>")
  .description("Create a new GitHub repo from a folder and push it in one commit")
  .option("--name <name>", "Repo name (defaults to the folder name)")
  .option("--description <desc>", "Repo description")
  .option("--public", "Create a public repo (default: private)")
  .option("--message <msg>", "Commit message")
  .option("--token <token>", "GitHub token override (else uses your connected token)")
  .option("--yes", "Publish even if possible secrets are found")
  .action(async (dir, opts) => {
    const cfg = loadConfig();
    if (!existsSync(dir)) fail(`No such folder: ${dir}`);

    const all = await walkProject(dir);
    if (!all.length) fail(`No files found in ${dir}`);
    const giPath = join(dir, ".gitignore");
    const gitignore = existsSync(giPath) ? await readFile(giPath, "utf8") : undefined;
    const plan = planRepoUpload(all, { gitignore });
    if (!plan.include.length) fail("Every file was filtered out (check .gitignore and size limits).");

    const files: { path: string; content: string; encoding: "utf-8" | "base64" }[] = [];
    const texts = new Map<string, string>();
    for (const f of plan.include) {
      const enc = encodeFile(await readFile(join(dir, f.path)));
      files.push({ path: f.path, ...enc });
      if (enc.encoding === "utf-8") texts.set(f.path, enc.content);
    }

    const scan = scanSecrets(texts);
    if (scan.risky && !opts.yes) {
      console.error("✗ Possible secrets found — review, then re-run with --yes:");
      for (const s of scan.findings.slice(0, 20)) console.error(`  ${s.path}:${s.line} — ${s.text}`);
      process.exit(1);
    }

    const name = sanitizeRepoName(opts.name || basename(resolve(dir)));
    if (!isValidRepoName(name)) fail(`Invalid repo name: ${name}`);

    const { repo } = await api<{ repo: { htmlUrl: string; owner: string; repo: string } }>("/repos/publish", cfg, {
      method: "POST",
      body: JSON.stringify({
        name,
        description: opts.description,
        private: !opts.public,
        commitMessage: opts.message,
        allowSecrets: !!opts.yes,
        token: opts.token,
        files,
      }),
    });
    console.log(`✓ Published ${repo.owner}/${repo.repo} (${plan.include.length} file${plan.include.length === 1 ? "" : "s"}${plan.skipped.length ? `, ${plan.skipped.length} skipped` : ""})`);
    console.log(`  ${repo.htmlUrl}`);
  });

program.parseAsync().catch((err) => fail(err instanceof Error ? err.message : String(err)));
