import type { LintResult } from "./types.js";

const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const TRIGGER_HINT = /(use when|when the user|trigger|use this)/i;
const ALLOWED_FRONTMATTER = new Set([
  "name",
  "description",
  "license",
  "compatibility",
  "metadata",
  "allowed-tools",
]);

export interface LintInput {
  frontmatter: Record<string, unknown>;
  body: string;
  files: string[];
  folderName?: string;
}

/**
 * Lint a skill against the Agent Skills conventions. (§6.5)
 * Runs client-side before upload and server-side on finalize.
 */
export function lintSkill(input: LintInput): LintResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const infos: string[] = [];

  const hasSkillMd = input.files.some((f) => /^SKILL\.md$/i.test(f));
  if (!hasSkillMd) {
    errors.push("SKILL.md is required at the top level.");
  }

  const name = String(input.frontmatter.name ?? input.folderName ?? "").trim();
  if (!name) {
    errors.push("name is required in frontmatter.");
  } else {
    if (name.length < 1 || name.length > 64) {
      errors.push("name must be 1–64 characters.");
    }
    if (!NAME_RE.test(name)) {
      errors.push("name must be lowercase, hyphen-separated (e.g. pdf-tools).");
    }
    if (input.folderName && name !== input.folderName) {
      warnings.push(`name "${name}" should match the folder name "${input.folderName}".`);
    }
  }

  const description = String(input.frontmatter.description ?? "").trim();
  if (!description) {
    errors.push("description is required.");
  } else {
    if (description.length > 1024) {
      errors.push("description must be ≤ 1024 characters.");
    }
    if (!TRIGGER_HINT.test(description)) {
      warnings.push('description should say when to use the skill ("use when…").');
    }
  }

  // broken relative references in the body
  const refRe = /\]\((\.\/|\.\.\/)?([\w./-]+\.\w+)\)/g;
  let m: RegExpExecArray | null;
  const fileSet = new Set(input.files.map((f) => f.replace(/^\.\//, "")));
  while ((m = refRe.exec(input.body))) {
    const ref = (m[2] ?? "").replace(/^\.\//, "");
    if (ref && !/^https?:/i.test(ref) && !fileSet.has(ref)) {
      warnings.push(`Referenced file "${ref}" is not in the skill.`);
    }
  }

  const bodyLines = input.body.split("\n").length;
  if (bodyLines > 500) {
    warnings.push("SKILL.md is over 500 lines — move detail into references/.");
  }

  for (const key of Object.keys(input.frontmatter)) {
    if (!ALLOWED_FRONTMATTER.has(key)) {
      infos.push(`Unknown frontmatter key "${key}".`);
    }
  }

  return { ok: errors.length === 0, errors, warnings, infos };
}

/** Parse a very small subset of YAML frontmatter (flat key: value + string arrays). */
export function parseFrontmatter(src: string): { data: Record<string, unknown>; content: string } {
  const match = src.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { data: {}, content: src };
  const data: Record<string, unknown> = {};
  const lines = (match[1] ?? "").split("\n");
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const kv = line.match(/^([\w-]+):\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1]!;
    let value = (kv[2] ?? "").trim();
    if (value.startsWith("[") && value.endsWith("]")) {
      data[key] = value
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
    } else {
      data[key] = value.replace(/^["']|["']$/g, "");
    }
  }
  return { data, content: match[2] ?? "" };
}
