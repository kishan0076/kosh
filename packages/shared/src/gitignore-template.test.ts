import { describe, expect, it } from "vitest";
import { buildGitignore, detectStacks, gitignoreForPaths } from "./gitignore-template.js";

describe("detectStacks", () => {
  it("detects node from package.json", () => {
    expect(detectStacks(["package.json", "src/app.ts"])).toContain("node");
  });
  it("detects python from a manifest or .py files", () => {
    expect(detectStacks(["pyproject.toml"])).toContain("python");
    expect(detectStacks(["main.py"])).toContain("python");
  });
  it("detects go / rust / java / dotnet", () => {
    expect(detectStacks(["go.mod"])).toContain("go");
    expect(detectStacks(["Cargo.toml"])).toContain("rust");
    expect(detectStacks(["pom.xml"])).toContain("java");
    expect(detectStacks(["App.csproj"])).toContain("dotnet");
  });
  it("detects multiple stacks in one project", () => {
    const s = detectStacks(["package.json", "requirements.txt", "go.mod"]);
    expect(s).toEqual(expect.arrayContaining(["node", "python", "go"]));
  });
  it("returns nothing for an unknown project", () => {
    expect(detectStacks(["README.md", "LICENSE"])).toEqual([]);
  });
});

describe("buildGitignore", () => {
  it("always includes the common block", () => {
    const gi = buildGitignore([]);
    expect(gi).toContain(".DS_Store");
    expect(gi).toContain(".env");
    expect(gi).toContain("!.env.example");
  });
  it("appends per-stack blocks and ends with a newline", () => {
    const gi = buildGitignore(["node"]);
    expect(gi).toContain("node_modules/");
    expect(gi.endsWith("\n")).toBe(true);
  });
  it("de-duplicates repeated stacks", () => {
    const gi = buildGitignore(["node", "node"]);
    expect(gi.match(/# Node/g)?.length).toBe(1);
  });
  it("gitignoreForPaths composes detection + build", () => {
    const gi = gitignoreForPaths(["Cargo.toml", "src/main.rs"]);
    expect(gi).toContain("/target/");
    expect(gi).toContain(".DS_Store");
  });
});
