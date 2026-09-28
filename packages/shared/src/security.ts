/**
 * Security posture — one rolled-up score over the signals Kosh already computes, so the whole vault's
 * risk surface reads at a glance (roadmap moonshot: "security posture dashboard").
 *
 * Pure + dependency-free (unit-tested): it takes the user's items/skills/collections/packs/keys and returns
 * a weighted 0–100 score, a letter grade, per-category breakdowns, and a ranked list of actionable findings.
 * Every signal reuses an existing rule set — skill trust + the static skill scan (`skill-scan`), a shared
 * secret detector, public-share flags, and API-key hygiene — so the dashboard never invents new policy.
 */
import type { ApiKey, Collection, ContextPack, Item, Skill } from "./types.js";

export type PostureCategoryId = "skills" | "secrets" | "sharing" | "keys";
export type PostureSeverity = "critical" | "warning" | "info";

export interface PostureFinding {
  /** Stable id so a list can key + dedupe without an index. */
  id: string;
  category: PostureCategoryId;
  severity: PostureSeverity;
  title: string;
  detail: string;
  /** Back-links into the app (whichever applies). */
  itemId?: string;
  skillId?: string;
  collectionId?: string;
  packId?: string;
  /** A short suggested next step. */
  action?: string;
}

export interface PostureCategory {
  id: PostureCategoryId;
  label: string;
  /** 0–100 for this category alone. */
  score: number;
  /** Relative weight in the overall score. */
  weight: number;
  /** How many things were evaluated (skills, shares, scanned texts, keys). */
  evaluated: number;
  /** Findings raised in this category. */
  issues: number;
  summary: string;
}

export interface SecurityPosture {
  /** Weighted 0–100 across categories. */
  score: number;
  grade: "A" | "B" | "C" | "D" | "F";
  categories: PostureCategory[];
  /** All findings, ranked most-severe first. */
  findings: PostureFinding[];
  counts: { critical: number; warning: number; info: number };
}

export interface PostureInput {
  items: Item[];
  skills: Skill[];
  collections: Collection[];
  packs?: (ContextPack & { itemCount?: number })[];
  apiKeys?: (ApiKey | { id: string; name: string; scopes: string[]; lastUsedAt?: string; createdAt: string; revokedAt?: string })[];
  /** Current time (ms) for stale-key math — passed in so the scorer stays pure. */
  now: number;
}

/* ── secret detection (shared by every scanned text) ── */

interface SecretRule {
  id: string;
  label: string;
  re: RegExp;
}

// High-signal, low-false-positive patterns for well-known credential shapes. Deliberately conservative:
// a security dashboard that cries wolf gets ignored, so a generic assignment needs a keyword + a long value.
const SECRET_RULES: SecretRule[] = [
  { id: "private-key", label: "a private key block", re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/ },
  { id: "aws-access-key", label: "an AWS access key id", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { id: "github-token", label: "a GitHub token", re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b|\bgithub_pat_[A-Za-z0-9_]{22,}\b/ },
  { id: "slack-token", label: "a Slack token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { id: "google-api-key", label: "a Google API key", re: /\bAIza[0-9A-Za-z_\-]{35}\b/ },
  { id: "openai-key", label: "an OpenAI/Anthropic-style key", re: /\bsk-(?:ant-)?[A-Za-z0-9_\-]{20,}\b/ },
  { id: "generic-secret", label: "a hard-coded secret", re: /\b(?:api[_-]?key|secret|password|passwd|token|access[_-]?key)\b\s*[:=]\s*['"][A-Za-z0-9!@#$%^&*_\-]{16,}['"]/i },
];

/** Every distinct secret rule that matches the text (deduped by rule id, order-stable). */
export function findSecrets(text: string): { id: string; label: string }[] {
  if (!text) return [];
  const hits: { id: string; label: string }[] = [];
  for (const rule of SECRET_RULES) {
    if (rule.re.test(text)) hits.push({ id: rule.id, label: rule.label });
  }
  return hits;
}

/* ── helpers ── */

const clamp = (n: number): number => Math.max(0, Math.min(100, Math.round(n)));

const gradeFor = (score: number): SecurityPosture["grade"] =>
  score >= 90 ? "A" : score >= 80 ? "B" : score >= 65 ? "C" : score >= 50 ? "D" : "F";

const isLive = (i: { deletedAt?: string }): boolean => !i.deletedAt;

/** The scannable free-text of an item (note, description, prompt body) — where a pasted secret hides. */
function itemText(i: Item): string {
  return [i.note, i.description, i.prompt?.body].filter(Boolean).join("\n");
}

const STALE_KEY_DAYS = 90;

/**
 * Compute the whole security posture. Deterministic and pure — same input, same output.
 * Categories each start at 100 and lose points per finding (capped), then combine by weight.
 */
export function securityPosture(input: PostureInput): SecurityPosture {
  const findings: PostureFinding[] = [];
  const items = input.items.filter(isLive);
  const skills = input.skills.filter(isLive);

  /* 1 ── Skill trust + static risk scan ─────────────────────────────── */
  // Index-only skills aren't copied into the vault, so they aren't an execution surface — skip them.
  const installed = skills.filter((s) => !s.indexOnly);
  for (const s of installed) {
    const latest = s.versions.find((v) => v.n === s.latest) ?? s.versions.at(-1);
    const risky = !!latest?.scan?.risky;
    const label = s.displayName || s.name;
    if (risky) {
      const n = latest?.scan?.findings.length ?? 0;
      findings.push({
        id: `skill-risky-${s.id}`,
        category: "skills",
        severity: s.trust === "reviewed" || s.trust === "mine" ? "warning" : "critical",
        title: `Risky skill: ${label}`,
        detail: `The static scan flagged ${n} finding${n === 1 ? "" : "s"}${s.trust === "unreviewed" ? " and it hasn't been reviewed" : ""}.`,
        skillId: s.id,
        itemId: s.itemId,
        action: s.trust === "unreviewed" ? "Review the scan findings before use" : "Recheck the scan findings",
      });
    } else if (s.trust === "unreviewed") {
      findings.push({
        id: `skill-unreviewed-${s.id}`,
        category: "skills",
        severity: "warning",
        title: `Unreviewed skill: ${label}`,
        detail: "Copied from a stranger's repo and not yet reviewed — it runs with whatever tools it declares.",
        skillId: s.id,
        itemId: s.itemId,
        action: "Review and mark it trusted",
      });
    }
  }
  const skillIssues = findings.filter((f) => f.category === "skills").length;
  const skillPenalty = findings
    .filter((f) => f.category === "skills")
    .reduce((a, f) => a + (f.severity === "critical" ? 22 : 12), 0);

  /* 2 ── Secrets pasted into content ─────────────────────────────────── */
  let scanned = 0;
  for (const i of items) {
    const text = itemText(i);
    if (!text.trim()) continue;
    scanned++;
    const hits = findSecrets(text);
    for (const h of hits) {
      findings.push({
        id: `secret-${i.id}-${h.id}`,
        category: "secrets",
        severity: "critical",
        title: `Possible secret in “${i.title || i.url || "an item"}”`,
        detail: `Looks like ${h.label} in this item's notes or body. Move it to the encrypted vault and rotate it.`,
        itemId: i.id,
        action: "Remove the secret and rotate it",
      });
    }
  }
  // Skill file previews can carry secrets too.
  for (const s of installed) {
    const latest = s.versions.find((v) => v.n === s.latest) ?? s.versions.at(-1);
    for (const f of latest?.files ?? []) {
      if (!f.content) continue;
      scanned++;
      for (const h of findSecrets(f.content)) {
        findings.push({
          id: `secret-skill-${s.id}-${f.path}-${h.id}`,
          category: "secrets",
          severity: "critical",
          title: `Possible secret in ${s.displayName || s.name}/${f.path}`,
          detail: `Looks like ${h.label} inside a skill file. Remove it and rotate the credential.`,
          skillId: s.id,
          itemId: s.itemId,
          action: "Remove the secret and rotate it",
        });
      }
    }
  }
  const secretIssues = findings.filter((f) => f.category === "secrets").length;
  const secretPenalty = secretIssues * 40; // any real secret is severe

  /* 3 ── Over-shared / public exposure ───────────────────────────────── */
  let shareSurfaces = 0;
  for (const c of input.collections) {
    if (c.public) {
      shareSurfaces++;
      const count = items.filter((i) => i.collections.includes(c.id)).length;
      findings.push({
        id: `share-collection-${c.id}`,
        category: "sharing",
        severity: "info",
        title: `Public collection: ${c.name}`,
        detail: `Anyone with the link can view ${count} item${count === 1 ? "" : "s"} in this collection.`,
        collectionId: c.id,
        action: "Confirm this is meant to be public",
      });
    }
  }
  for (const p of input.packs ?? []) {
    if (p.public) {
      shareSurfaces++;
      const count = p.itemCount ?? p.itemIds.length;
      findings.push({
        id: `share-pack-${p.id}`,
        category: "sharing",
        severity: "info",
        title: `Public context pack: ${p.name}`,
        detail: `Anyone with the link can view this pack (${count} item${count === 1 ? "" : "s"}).`,
        packId: p.id,
        action: "Confirm this is meant to be public",
      });
    }
  }
  for (const s of skills) {
    if (s.public) {
      shareSurfaces++;
      findings.push({
        id: `share-skill-${s.id}`,
        category: "sharing",
        severity: "info",
        title: `Public skill: ${s.displayName || s.name}`,
        detail: "Anyone with the link can view this skill's files.",
        skillId: s.id,
        itemId: s.itemId,
        action: "Confirm this is meant to be public",
      });
    }
  }
  // Public exposure is a surface to *confirm*, not inherently a defect — a light penalty, capped.
  const sharePenalty = Math.min(shareSurfaces * 6, 30);

  /* 4 ── API-key hygiene ─────────────────────────────────────────────── */
  const keys = (input.apiKeys ?? []).filter((k) => !("revokedAt" in k) || !k.revokedAt);
  for (const k of keys) {
    const lastUsed = k.lastUsedAt ? Date.parse(k.lastUsedAt) : Date.parse(k.createdAt);
    const ageDays = Number.isFinite(lastUsed) ? (input.now - lastUsed) / 86_400_000 : 0;
    const canWrite = k.scopes.includes("write");
    if (ageDays > STALE_KEY_DAYS) {
      findings.push({
        id: `key-stale-${k.id}`,
        category: "keys",
        severity: canWrite ? "warning" : "info",
        title: `Stale API key: ${k.name}`,
        detail: `Not used in ${Math.round(ageDays)} days${canWrite ? " and it can write to your vault" : ""}. Revoke it if it's no longer needed.`,
        action: "Revoke this key",
      });
    }
  }
  const keyIssues = findings.filter((f) => f.category === "keys").length;
  const keyPenalty = findings
    .filter((f) => f.category === "keys")
    .reduce((a, f) => a + (f.severity === "warning" ? 15 : 8), 0);

  /* ── assemble categories ── */
  const categories: PostureCategory[] = [
    {
      id: "skills",
      label: "Skill trust",
      score: clamp(100 - skillPenalty),
      weight: 3,
      evaluated: installed.length,
      issues: skillIssues,
      summary: skillIssues === 0 ? "Every installed skill is reviewed and clean." : `${skillIssues} skill${skillIssues === 1 ? "" : "s"} need${skillIssues === 1 ? "s" : ""} attention.`,
    },
    {
      id: "secrets",
      label: "Secret exposure",
      score: clamp(100 - secretPenalty),
      weight: 4,
      evaluated: scanned,
      issues: secretIssues,
      summary: secretIssues === 0 ? "No secrets detected in your notes or skills." : `${secretIssues} possible secret${secretIssues === 1 ? "" : "s"} found — rotate them.`,
    },
    {
      id: "sharing",
      label: "Public exposure",
      score: clamp(100 - sharePenalty),
      weight: 2,
      evaluated: shareSurfaces,
      issues: findings.filter((f) => f.category === "sharing").length,
      summary: shareSurfaces === 0 ? "Nothing is shared publicly." : `${shareSurfaces} public link${shareSurfaces === 1 ? "" : "s"} to review.`,
    },
    {
      id: "keys",
      label: "API keys",
      score: clamp(100 - keyPenalty),
      weight: 1,
      evaluated: keys.length,
      issues: keyIssues,
      summary: keyIssues === 0 ? "No stale keys." : `${keyIssues} key${keyIssues === 1 ? "" : "s"} to clean up.`,
    },
  ];

  const totalWeight = categories.reduce((a, c) => a + c.weight, 0);
  const score = clamp(categories.reduce((a, c) => a + c.score * c.weight, 0) / totalWeight);

  const rank: Record<PostureSeverity, number> = { critical: 0, warning: 1, info: 2 };
  findings.sort((a, b) => rank[a.severity] - rank[b.severity]);

  return {
    score,
    grade: gradeFor(score),
    categories,
    findings,
    counts: {
      critical: findings.filter((f) => f.severity === "critical").length,
      warning: findings.filter((f) => f.severity === "warning").length,
      info: findings.filter((f) => f.severity === "info").length,
    },
  };
}
