import type { InstallInfo, RepoKind } from "./types.js";

/** Minimal repo metadata needed for kind detection (subset of the GitHub API). */
export interface RepoInfo {
  name: string;
  topics?: string[];
  is_template?: boolean;
  language?: string | null;
}

export interface TreeEntry {
  path: string;
  type: "blob" | "tree";
  size?: number;
  sha?: string;
}

/** Parsed manifests found in a repo (only the fields we use). */
export interface Manifests {
  pkg?: {
    name?: string;
    bin?: unknown;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  pyDeps?: Record<string, string>;
  pyScripts?: boolean;
  goModule?: boolean;
}

/** Detect what kind of repo this is — no AI, signal-based. (§5.5) */
export function detectRepoKind(r: RepoInfo, tree: TreeEntry[], manifests: Manifests): { kind: RepoKind; signals: string[] } {
  const signals: string[] = [];
  const paths = new Set(tree.map((t) => t.path));
  const topics = new Set(r.topics ?? []);
  const deps = { ...manifests.pkg?.dependencies, ...manifests.pkg?.devDependencies, ...manifests.pyDeps };
  const hasPath = (pred: (p: string) => boolean) => [...paths].some(pred);

  if (hasPath((p) => /(^|\/)SKILL\.md$/i.test(p))) signals.push("has SKILL.md");
  if (["agent-skills", "claude-skills", "skills"].some((t) => topics.has(t))) signals.push("topic:skills");
  if (signals.length) return { kind: "skills", signals };

  if (deps["@modelcontextprotocol/sdk"] || deps["mcp"] || deps["fastmcp"] || topics.has("mcp") || topics.has("mcp-server") || /-mcp$/.test(r.name)) {
    return { kind: "mcp-server", signals: ["mcp dependency/topic"] };
  }
  if (paths.has("action.yml") || paths.has("action.yaml") || [...paths].filter((p) => p.startsWith(".github/workflows/")).length > 3 || hasPath((p) => /n8n|workflow.*\.json$/i.test(p)) || ["automation", "workflow", "github-action"].some((t) => topics.has(t))) {
    return { kind: "automation", signals: ["workflow files"] };
  }
  if (manifests.pkg?.bin || manifests.pyScripts || paths.has("cmd") || topics.has("cli")) {
    return { kind: "cli", signals: ["bin/scripts"] };
  }
  if (["agents", "ai-agents", "llm-agents"].some((t) => topics.has(t)) || deps["langchain"] || deps["crewai"] || deps["@anthropic-ai/claude-agent-sdk"] || deps["openai-agents"]) {
    return { kind: "agent-framework", signals: ["agent deps/topics"] };
  }
  if (/^awesome-/i.test(r.name) || topics.has("awesome")) {
    return { kind: "awesome-list", signals: ["awesome"] };
  }
  if (r.is_template || ["boilerplate", "starter", "template"].some((t) => topics.has(t))) {
    return { kind: "template", signals: ["template"] };
  }
  if (paths.has("Dockerfile") && (deps["vite"] || deps["next"] || deps["expo"] || deps["react"])) {
    return { kind: "app", signals: ["dockerfile + ui"] };
  }
  if (manifests.pkg?.name && !manifests.pkg.bin) {
    return { kind: "library", signals: ["package, no bin"] };
  }
  return { kind: "other", signals: [] };
}

const INSTALL_LINE =
  /(npx\s+skills\s+add\s+\S+|npx\s+\S+|uvx\s+\S+|pipx\s+install\s+\S+|pip\s+install\s+\S+|npm\s+i(?:nstall)?\s+-g\s+\S+|brew\s+install\s+\S+|cargo\s+install\s+\S+|claude\s+mcp\s+add\s+[^\n]+|codex\s+mcp\s+add\s+[^\n]+)/i;

/** Extract a copy-paste install command with confidence — never guessed. (§5.5) */
export function extractInstall(readme: string, manifests: Manifests): InstallInfo {
  // 1) README fenced code blocks
  const fences = [...readme.matchAll(/```[a-z]*\n([\s\S]*?)```/gi)].map((m) => m[1] ?? "");
  for (const block of fences) {
    for (const line of block.split("\n")) {
      const m = line.trim().match(INSTALL_LINE);
      if (m) return { command: m[0].trim(), source: "readme" };
    }
  }
  // also scan inline for the highest-signal commands even outside fences
  const inline = readme.match(/(npx\s+skills\s+add\s+\S+|claude\s+mcp\s+add\s+[^\n`]+)/i);
  if (inline) return { command: inline[0].trim(), source: "readme" };

  // 2) package.json bin → npx <name>
  if (manifests.pkg?.bin && manifests.pkg.name) {
    return { command: `npx ${manifests.pkg.name}`, source: "package.json" };
  }
  // 3) pyproject scripts → uvx <name>
  if (manifests.pyScripts && manifests.pkg?.name) {
    return { command: `uvx ${manifests.pkg.name}`, source: "pyproject" };
  }
  return { source: "none" };
}
