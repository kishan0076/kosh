import { describe, expect, it } from "vitest";
import { detectRepoKind, extractInstall, type TreeEntry } from "./repo.js";

const tree = (paths: string[]): TreeEntry[] => paths.map((p) => ({ path: p, type: p.endsWith("/") ? "tree" : "blob" }));

describe("detectRepoKind", () => {
  it("detects skills by SKILL.md", () => {
    expect(detectRepoKind({ name: "skills" }, tree(["document-skills/pdf/SKILL.md"]), {}).kind).toBe("skills");
  });
  it("detects skills by topic", () => {
    expect(detectRepoKind({ name: "x", topics: ["claude-skills"] }, tree(["README.md"]), {}).kind).toBe("skills");
  });
  it("detects mcp-server by dependency and name", () => {
    expect(detectRepoKind({ name: "foo" }, tree(["src/index.ts"]), { pkg: { dependencies: { "@modelcontextprotocol/sdk": "1.0.0" } } }).kind).toBe("mcp-server");
    expect(detectRepoKind({ name: "github-mcp" }, tree(["main.go"]), {}).kind).toBe("mcp-server");
  });
  it("detects cli by bin", () => {
    expect(detectRepoKind({ name: "tool" }, tree(["index.js"]), { pkg: { name: "tool", bin: { tool: "cli.js" } } }).kind).toBe("cli");
  });
  it("detects awesome-list", () => {
    expect(detectRepoKind({ name: "awesome-mcp-servers" }, tree(["README.md"]), {}).kind).toBe("awesome-list");
  });
  it("detects template and library", () => {
    expect(detectRepoKind({ name: "starter", is_template: true }, tree(["README.md"]), {}).kind).toBe("template");
    expect(detectRepoKind({ name: "lib" }, tree(["index.ts"]), { pkg: { name: "lib" } }).kind).toBe("library");
  });
  it("falls back to other", () => {
    expect(detectRepoKind({ name: "misc" }, tree(["notes.txt"]), {}).kind).toBe("other");
  });
});

describe("extractInstall", () => {
  it("extracts a fenced npx command", () => {
    const readme = "# x\n\n```bash\nnpx skills add document-skills/pdf\n```\n";
    expect(extractInstall(readme, {})).toEqual({ command: "npx skills add document-skills/pdf", source: "readme" });
  });
  it("extracts claude mcp add", () => {
    const readme = "install:\n\n```\nclaude mcp add github --url https://api.example/mcp\n```";
    const r = extractInstall(readme, {});
    expect(r.source).toBe("readme");
    expect(r.command).toContain("claude mcp add github");
  });
  it("falls back to package.json bin", () => {
    expect(extractInstall("no commands here", { pkg: { name: "kosh", bin: { kosh: "cli.js" } } })).toEqual({ command: "npx kosh", source: "package.json" });
  });
  it("returns none when nothing found", () => {
    expect(extractInstall("just prose", {})).toEqual({ source: "none" });
  });
});
