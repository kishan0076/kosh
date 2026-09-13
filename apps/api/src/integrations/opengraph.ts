import { safeFetch } from "./safe-fetch.js";

export interface OgResult {
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
}

function meta(html: string, patterns: RegExp[]): string | undefined {
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) return decode(m[1].trim());
  }
  return undefined;
}

function decode(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'");
}

/** Fetch Open Graph / basic metadata for a URL via safeFetch. */
export async function fetchOpenGraph(url: string): Promise<OgResult> {
  const { body, url: finalUrl } = await safeFetch(url, { maxBytes: 1_500_000, timeoutMs: 8000 });
  const title =
    meta(body, [
      /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"']+)["']/i,
      /<title[^>]*>([^<]+)<\/title>/i,
    ]);
  const description = meta(body, [
    /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i,
  ]);
  const image = meta(body, [/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i]);
  const siteName =
    meta(body, [/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i]) ??
    new URL(finalUrl).hostname.replace(/^www\./, "");
  return { title, description, image, siteName };
}
