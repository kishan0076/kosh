import type { RepoKind, Stage, Tool, Trust } from "./types.js";

export const STAGES: Stage[] = ["to-try", "trying", "using", "dropped"];

export const STAGE_LABEL: Record<Stage, string> = {
  "to-try": "To try",
  trying: "Trying",
  using: "Using",
  dropped: "Dropped",
};

export const TOOLS: Tool[] = ["claude", "codex", "cursor", "gemini", "generic"];

export const TOOL_LABEL: Record<Tool, string> = {
  claude: "Claude",
  codex: "Codex",
  cursor: "Cursor",
  gemini: "Gemini",
  generic: "Generic",
};

export const REPO_KINDS: RepoKind[] = [
  "skills",
  "mcp-server",
  "automation",
  "cli",
  "agent-framework",
  "library",
  "awesome-list",
  "template",
  "app",
  "other",
];

export const REPO_KIND_LABEL: Record<RepoKind, string> = {
  skills: "Skills",
  "mcp-server": "MCP server",
  automation: "Automation",
  cli: "CLI",
  "agent-framework": "Agent framework",
  library: "Library",
  "awesome-list": "Awesome list",
  template: "Template",
  app: "App",
  other: "Other",
};

export const TRUST_LABEL: Record<Trust, string> = {
  mine: "Yours",
  reviewed: "Reviewed",
  unreviewed: "Unreviewed",
};

/** GitHub Linguist-style colors for common languages (link-card edge). */
export const LANGUAGE_COLOR: Record<string, string> = {
  TypeScript: "#3178c6",
  JavaScript: "#f1e05a",
  Python: "#3572A5",
  Go: "#00ADD8",
  Rust: "#dea584",
  Ruby: "#701516",
  Java: "#b07219",
  "C++": "#f34b7d",
  C: "#555555",
  "C#": "#178600",
  Shell: "#89e051",
  HTML: "#e34c26",
  CSS: "#563d7c",
  Vue: "#41b883",
  Svelte: "#ff3e00",
  Kotlin: "#A97BFF",
  Swift: "#F05138",
  Dart: "#00B4AB",
  PHP: "#4F5D95",
  Lua: "#000080",
  Zig: "#ec915c",
  Elixir: "#6e4a7e",
  Jupyter: "#DA5B0B",
  MDX: "#fcb32c",
};

export const DEFAULT_LANGUAGE_COLOR = "#8C97B2";

export function languageColor(lang?: string): string {
  if (!lang) return DEFAULT_LANGUAGE_COLOR;
  return LANGUAGE_COLOR[lang] ?? DEFAULT_LANGUAGE_COLOR;
}

/** Priority per ingest source (higher = sooner). (§5.2) */
export const SOURCE_PRIORITY: Record<string, number> = {
  web: 10,
  bot: 10,
  share: 8,
  bookmarklet: 8,
  email: 8,
  mcp: 8,
  cli: 8,
  import: 3,
  snapshot: 3,
};

/** Allowlisted upload extensions. (§6.2) */
export const ALLOWED_EXTENSIONS = [
  "md", "mdx", "txt", "json", "yaml", "yml", "toml", "csv",
  "py", "js", "ts", "tsx", "jsx", "sh", "ps1", "rb", "go", "rs", "sql",
  "html", "css", "svg", "png", "jpg", "webp", "pdf",
];

export const BLOCKED_EXTENSIONS = ["exe", "dll", "msi", "dmg", "app"];
