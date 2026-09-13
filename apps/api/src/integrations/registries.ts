import type { Registry } from "@kosh/shared";
import { safeFetch } from "./safe-fetch.js";

export interface PackageInfo {
  registry: Registry;
  name: string;
  version?: string;
  repoUrl?: string;
}

/** Parse a package-registry page URL into { registry, name }. */
export function parsePackageUrl(url: string): { registry: Registry; name: string } | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\./, "");
  const parts = u.pathname.split("/").filter(Boolean);
  if (host === "npmjs.com") {
    const idx = parts.indexOf("package");
    if (idx >= 0 && parts[idx + 1]) return { registry: "npm", name: parts.slice(idx + 1).join("/") };
  }
  if (host === "pypi.org" && parts[0] === "project" && parts[1]) return { registry: "pypi", name: parts[1] };
  if (host === "crates.io" && parts[0] === "crates" && parts[1]) return { registry: "crates", name: parts[1] };
  if (host === "hub.docker.com" && (parts[0] === "r" || parts[0] === "_") && parts[1]) {
    return { registry: "docker", name: parts.slice(1).join("/") };
  }
  return null;
}

function cleanRepoUrl(raw?: string): string | undefined {
  if (!raw) return undefined;
  const m = raw.match(/github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:$|[/#?])/i);
  return m ? `https://github.com/${m[1]}/${m[2]}` : undefined;
}

/** Look up a package's version + source repo from its registry JSON API. */
export async function lookupPackage(registry: Registry, name: string): Promise<PackageInfo> {
  const info: PackageInfo = { registry, name };
  try {
    if (registry === "npm") {
      // the full packument can be many MB (version history); /latest is small and has what we need
      const { body } = await safeFetch(`https://registry.npmjs.org/${encodeURIComponent(name).replace("%40", "@")}/latest`, { maxBytes: 1_000_000 });
      const j = JSON.parse(body);
      info.version = j.version;
      info.repoUrl = cleanRepoUrl(typeof j.repository === "string" ? j.repository : j.repository?.url);
    } else if (registry === "pypi") {
      const { body } = await safeFetch(`https://pypi.org/pypi/${encodeURIComponent(name)}/json`, { maxBytes: 4_000_000 });
      const j = JSON.parse(body);
      info.version = j.info?.version;
      const urls: Record<string, string> = j.info?.project_urls ?? {};
      info.repoUrl = cleanRepoUrl(urls.Source ?? urls.Repository ?? urls.Homepage ?? j.info?.home_page);
    } else if (registry === "crates") {
      const { body } = await safeFetch(`https://crates.io/api/v1/crates/${encodeURIComponent(name)}`, { maxBytes: 2_000_000 });
      const j = JSON.parse(body);
      info.version = j.crate?.max_version;
      info.repoUrl = cleanRepoUrl(j.crate?.repository);
    }
  } catch {
    /* registry unreachable — return what we have */
  }
  return info;
}
