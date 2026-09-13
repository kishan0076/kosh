import type { ScanFinding, ScanResult } from "./types.js";

interface Rule {
  id: string;
  re: RegExp;
  message: string;
}

const ALLOWED_HOSTS = [
  "github.com",
  "raw.githubusercontent.com",
  "pypi.org",
  "registry.npmjs.org",
  "objects.githubusercontent.com",
];

const RULES: Rule[] = [
  {
    id: "pipe-to-shell",
    re: /(curl|wget)\s+[^\n|]*\|\s*(sudo\s+)?(sh|bash|zsh)\b/i,
    message: "pipes a download into a shell",
  },
  {
    id: "iwr-iex",
    re: /(iwr|invoke-webrequest)[^\n|]*\|\s*iex\b/i,
    message: "pipes a download into PowerShell",
  },
  {
    id: "base64-decode",
    re: /base64\s+(-d|--decode)\b/i,
    message: "decodes hidden base64 content",
  },
  {
    id: "unrestricted-bash",
    re: /allowed-tools:\s*(\[[^\]]*\bBash\b(?!\()[^\]]*\]|.*Bash\(\*\))/i,
    message: "requests unrestricted shell access",
  },
  {
    id: "prompt-injection",
    re: /(ignore\s+(?:(?:all|any|previous|prior|the|your|above|earlier)\s+)*instructions|disregard\s+(?:all\s+)?(?:previous|prior)|you\s+are\s+now|system\s+prompt)/i,
    message: "contains prompt-injection phrasing",
  },
  {
    id: "secrets-path",
    re: /(~\/\.ssh|~\/\.aws|\/\.env\b|\.env\s*$|keychain|id_rsa|credentials)/i,
    message: "touches secrets or credential paths",
  },
];

// zero-width spaces, bidi controls, BOM, and isolate/override marks
const INVISIBLE_RE = new RegExp("[\\u200B-\\u200F\\u2028-\\u202F\\uFEFF\\u2066-\\u2069]");
const LONG_BASE64_RE = /[A-Za-z0-9+/]{120,}={0,2}/;
const URL_RE = /https?:\/\/([a-z0-9.-]+)/gi;

/**
 * Static scan of every text file in a skill version. (§6.6)
 * Findings never block saving; they mark the version risky and keep it unreviewed.
 */
export function scanSkill(texts: Map<string, string>): ScanResult {
  const findings: ScanFinding[] = [];

  for (const [path, text] of texts) {
    const lines = text.split("\n");
    lines.forEach((line, i) => {
      const lineNo = i + 1;
      for (const rule of RULES) {
        if (rule.re.test(line)) {
          findings.push({ path, line: lineNo, rule: rule.id, text: rule.message });
        }
      }
      if (INVISIBLE_RE.test(line)) {
        findings.push({ path, line: lineNo, rule: "invisible-unicode", text: "hidden characters" });
      }
      if (LONG_BASE64_RE.test(line)) {
        findings.push({ path, line: lineNo, rule: "long-base64", text: "long base64 blob" });
      }
      let m: RegExpExecArray | null;
      URL_RE.lastIndex = 0;
      while ((m = URL_RE.exec(line))) {
        const host = (m[1] ?? "").toLowerCase();
        const isScript = /\.(py|js|ts|sh|ps1|rb|go|rs)$/i.test(path);
        if (isScript && host && !ALLOWED_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) {
          findings.push({ path, line: lineNo, rule: "external-host", text: `contacts external host ${host}` });
        }
      }
    });
  }

  return { risky: findings.length > 0, findings };
}
