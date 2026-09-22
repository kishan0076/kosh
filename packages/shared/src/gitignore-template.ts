/**
 * Stack detection + .gitignore generation. Pure and dependency-free so it can run in the browser
 * (local-folder scan) and be unit-tested. Given a flat list of file paths (repo-root relative), it
 * guesses the project's stacks and composes a sensible .gitignore.
 */

export type Stack = "node" | "python" | "go" | "rust" | "java" | "dotnet" | "ruby" | "php" | "swift" | "elixir";

const EXT = (p: string) => {
  const base = p.split("/").pop() ?? p;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
};
const base = (p: string) => (p.split("/").pop() ?? p).toLowerCase();

/** Detect the stacks present in a project from its file paths. Order is stable (declaration order). */
export function detectStacks(paths: string[]): Stack[] {
  const names = new Set(paths.map(base));
  const exts = new Set(paths.map(EXT));
  const has = (...n: string[]) => n.some((x) => names.has(x));
  const ext = (...e: string[]) => e.some((x) => exts.has(x));

  const found: Stack[] = [];
  if (has("package.json") || paths.some((p) => p.includes("node_modules/")) || ext("ts", "tsx", "jsx") ) found.push("node");
  if (has("requirements.txt", "pyproject.toml", "setup.py", "setup.cfg", "pipfile") || ext("py")) found.push("python");
  if (has("go.mod", "go.sum") || ext("go")) found.push("go");
  if (has("cargo.toml") || ext("rs")) found.push("rust");
  if (has("pom.xml", "build.gradle", "build.gradle.kts") || ext("java")) found.push("java");
  if (has("packages.config") || paths.some((p) => /\.(csproj|fsproj|sln)$/i.test(p))) found.push("dotnet");
  if (has("gemfile", "gemfile.lock", "rakefile") || ext("rb")) found.push("ruby");
  if (has("composer.json", "composer.lock") || ext("php")) found.push("php");
  if (has("package.swift") || paths.some((p) => /\.(xcodeproj|xcworkspace)/i.test(p)) || ext("swift")) found.push("swift");
  if (has("mix.exs") || ext("ex", "exs")) found.push("elixir");
  return found;
}

/** The always-included block (OS junk, editors, env files, logs). */
const COMMON = `# OS & editor
.DS_Store
Thumbs.db
.idea/
.vscode/
*.swp

# Environment & secrets
.env
.env.*
!.env.example

# Logs
*.log
logs/`;

const BLOCKS: Record<Stack, string> = {
  node: `# Node
node_modules/
dist/
build/
out/
.next/
.nuxt/
coverage/
.cache/
.turbo/
*.tsbuildinfo
npm-debug.log*
yarn-debug.log*
yarn-error.log*
.pnpm-debug.log*`,
  python: `# Python
__pycache__/
*.py[cod]
.venv/
venv/
env/
.pytest_cache/
.mypy_cache/
.ruff_cache/
*.egg-info/
dist/
build/`,
  go: `# Go
bin/
*.exe
*.test
*.out
vendor/`,
  rust: `# Rust
/target/
**/*.rs.bk
Cargo.lock`,
  java: `# Java
target/
*.class
*.jar
*.war
.gradle/
build/`,
  dotnet: `# .NET
bin/
obj/
*.user
.vs/`,
  ruby: `# Ruby
*.gem
.bundle/
vendor/bundle
tmp/
log/`,
  php: `# PHP
/vendor/
composer.phar
.phpunit.result.cache`,
  swift: `# Swift
.build/
DerivedData/
*.xcuserstate
Packages/`,
  elixir: `# Elixir
/_build/
/deps/
*.ez
erl_crash.dump`,
};

/**
 * Build a .gitignore from detected stacks. Always includes the common block; appends a per-stack block
 * for each detected stack (de-duplicated, stable order). With no stacks, returns the common block only.
 */
export function buildGitignore(stacks: Stack[]): string {
  const seen = new Set<Stack>();
  const parts = [COMMON];
  for (const s of stacks) {
    if (seen.has(s)) continue;
    seen.add(s);
    parts.push(BLOCKS[s]);
  }
  return parts.join("\n\n") + "\n";
}

/** Convenience: detect stacks from paths and build the .gitignore in one call. */
export function gitignoreForPaths(paths: string[]): string {
  return buildGitignore(detectStacks(paths));
}

/** A generic starter used when no folder has been scanned (kept in sync with the composed output). */
export const STARTER_GITIGNORE = buildGitignore(["node"]);
