import { describe, expect, it } from "vitest";
import {
  isDefaultIgnored,
  isValidRepoName,
  makeGitignoreMatcher,
  planRepoUpload,
  sanitizeRepoName,
  scanSecrets,
  type RepoFileMeta,
} from "./repo-upload.js";

describe("isDefaultIgnored", () => {
  it("skips well-known build/system paths at any depth", () => {
    expect(isDefaultIgnored("node_modules/react/index.js")).toBe(true);
    expect(isDefaultIgnored(".git/config")).toBe(true);
    expect(isDefaultIgnored("src/__pycache__/x.pyc")).toBe(true);
    expect(isDefaultIgnored("packages/app/.DS_Store")).toBe(true);
  });
  it("keeps ordinary source files", () => {
    expect(isDefaultIgnored("src/index.ts")).toBe(false);
    expect(isDefaultIgnored("README.md")).toBe(false);
    // "distance" contains "dist" as a substring but not as a segment
    expect(isDefaultIgnored("src/distance.ts")).toBe(false);
  });
});

describe("makeGitignoreMatcher", () => {
  it("handles bare names, globs, dir-only and rooted patterns", () => {
    const m = makeGitignoreMatcher(["*.log", "secret.txt", "build/", "/root-only.txt", "# a comment", "", "!keep.log"].join("\n"));
    expect(m("app.log")).toBe(true);
    expect(m("logs/app.log")).toBe(true);
    expect(m("secret.txt")).toBe(true);
    expect(m("nested/secret.txt")).toBe(true);
    expect(m("build/output.js")).toBe(true);
    expect(m("root-only.txt")).toBe(true);
    expect(m("sub/root-only.txt")).toBe(false); // rooted
    expect(m("index.ts")).toBe(false);
    // negation is ignored (best-effort), so keep.log is not un-ignored — but it also isn't ignored by any rule
    expect(m("keep.log")).toBe(true); // matched by *.log
  });
  it("matches nothing for empty input", () => {
    const m = makeGitignoreMatcher(undefined);
    expect(m("anything.ts")).toBe(false);
  });
});

describe("planRepoUpload", () => {
  const files: RepoFileMeta[] = [
    { path: "src/index.ts", size: 100 },
    { path: "node_modules/react/index.js", size: 5000 },
    { path: "secret.env.local", size: 20 },
    { path: "app.log", size: 30 },
    { path: "README.md", size: 200 },
  ];

  it("filters defaults and gitignore, keeps source, is deterministic (sorted)", () => {
    const plan = planRepoUpload(files, { gitignore: "*.log\n*.env.local" });
    const paths = plan.include.map((f) => f.path);
    expect(paths).toEqual(["README.md", "src/index.ts"]);
    expect(plan.totalBytes).toBe(300);
    const reasons = Object.fromEntries(plan.skipped.map((s) => [s.path, s.reason]));
    expect(reasons["node_modules/react/index.js"]).toMatch(/auto-skipped/);
    expect(reasons["app.log"]).toMatch(/gitignore/);
    expect(reasons["secret.env.local"]).toMatch(/gitignore/);
  });

  it("enforces per-file size cap", () => {
    const plan = planRepoUpload([{ path: "big.bin", size: 10 }, { path: "ok.txt", size: 2 }], { maxFileBytes: 5 });
    expect(plan.include.map((f) => f.path)).toEqual(["ok.txt"]);
    expect(plan.skipped[0]!.reason).toMatch(/too large/);
  });

  it("enforces file-count cap", () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ path: `f${i}.txt`, size: 1 }));
    const plan = planRepoUpload(many, { maxFiles: 3 });
    expect(plan.include).toHaveLength(3);
    expect(plan.skipped).toHaveLength(2);
    expect(plan.skipped[0]!.reason).toMatch(/file limit/);
  });

  it("enforces total-size cap", () => {
    const plan = planRepoUpload([{ path: "a.txt", size: 6 }, { path: "b.txt", size: 6 }], { maxTotalBytes: 8 });
    expect(plan.include.map((f) => f.path)).toEqual(["a.txt"]);
    expect(plan.skipped[0]!.reason).toMatch(/total-size/);
  });

  it("drops directory entries and leading slashes", () => {
    const plan = planRepoUpload([{ path: "/src/x.ts", size: 1 }, { path: "emptydir/", size: 0 }]);
    expect(plan.include.map((f) => f.path)).toEqual(["src/x.ts"]);
  });
});

describe("sanitizeRepoName", () => {
  it("produces valid GitHub names", () => {
    expect(sanitizeRepoName("My Cool Project")).toBe("My-Cool-Project");
    expect(sanitizeRepoName("/home/user/awesome_app")).toBe("awesome_app");
    expect(sanitizeRepoName("weird!!!name@@@")).toBe("weird-name");
    expect(sanitizeRepoName("--trim--")).toBe("trim");
    expect(sanitizeRepoName("")).toBe("new-project");
    expect(sanitizeRepoName("...")).toBe("new-project");
    expect(isValidRepoName(sanitizeRepoName("My Cool Project"))).toBe(true);
  });
  it("validates names correctly", () => {
    expect(isValidRepoName("my-repo")).toBe(true);
    expect(isValidRepoName("has space")).toBe(false);
    expect(isValidRepoName("")).toBe(false);
    expect(isValidRepoName("..")).toBe(false);
  });
});

describe("scanSecrets", () => {
  it("flags private keys, cloud keys and hardcoded secrets", () => {
    const texts = new Map<string, string>([
      ["config.js", `const apiKey = "sk-abcdef0123456789abcdef";`],
      ["deploy.sh", `export AWS_KEY=AKIAIOSFODNN7EXAMPLE`],
      ["id_rsa", `-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----`],
      [".env", `DATABASE_URL=postgres://real:pass@host/db`],
    ]);
    const res = scanSecrets(texts);
    expect(res.risky).toBe(true);
    const rules = new Set(res.findings.map((f) => f.rule));
    expect(rules.has("private-key")).toBe(true);
    expect(rules.has("aws-access-key")).toBe(true);
    expect(rules.has("env-value")).toBe(true);
    expect([...rules].some((r) => r === "hardcoded-secret" || r === "openai-key")).toBe(true);
  });

  it("ignores placeholders, comments and example env files", () => {
    const texts = new Map<string, string>([
      ["config.js", `const apiKey = "your-api-key-here"; // token = "xxx"`],
      [".env.example", `DATABASE_URL=postgres://user:password@host/db`],
      ["readme.md", `Set your token = "changeme" before running.`],
    ]);
    const res = scanSecrets(texts);
    expect(res.risky).toBe(false);
    expect(res.findings).toHaveLength(0);
  });

  it("returns clean for ordinary code", () => {
    const texts = new Map<string, string>([["index.ts", `export const add = (a: number, b: number) => a + b;`]]);
    expect(scanSecrets(texts).risky).toBe(false);
  });
});
