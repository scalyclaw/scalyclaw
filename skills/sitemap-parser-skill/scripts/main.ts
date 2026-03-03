import { XMLParser } from "fast-xml-parser";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  isArray: (name) => {
    // Ensure sitemap and url elements are always arrays
    return name === "sitemap" || name === "url";
  },
});

interface SitemapUrl {
  loc: string;
  lastmod?: string;
  changefreq?: string;
  priority?: number;
}

interface SitemapEntry {
  loc: string;
  lastmod?: string;
}

async function fetchXml(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "ScalyClaw-SitemapParser/1.0",
      Accept: "application/xml, text/xml, */*",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }

  return response.text();
}

function normalizeUrl(url: string): string {
  // If it's just a domain (no path), append /sitemap.xml
  try {
    const parsed = new URL(url);
    if (parsed.pathname === "/" || parsed.pathname === "") {
      return `${parsed.origin}/sitemap.xml`;
    }
    return url;
  } catch {
    // Maybe missing protocol
    if (!url.startsWith("http")) {
      return normalizeUrl(`https://${url}`);
    }
    throw new Error(`Invalid URL: ${url}`);
  }
}

function parseUrlset(parsed: any): SitemapUrl[] {
  const urlset = parsed.urlset;
  if (!urlset || !urlset.url) return [];

  const urls = Array.isArray(urlset.url) ? urlset.url : [urlset.url];

  return urls.map((u: any) => {
    const entry: SitemapUrl = { loc: u.loc };
    if (u.lastmod) entry.lastmod = String(u.lastmod);
    if (u.changefreq) entry.changefreq = String(u.changefreq);
    if (u.priority !== undefined) entry.priority = Number(u.priority);
    return entry;
  });
}

function parseSitemapIndex(parsed: any): SitemapEntry[] {
  const index = parsed.sitemapindex;
  if (!index || !index.sitemap) return [];

  const sitemaps = Array.isArray(index.sitemap) ? index.sitemap : [index.sitemap];

  return sitemaps.map((s: any) => {
    const entry: SitemapEntry = { loc: s.loc };
    if (s.lastmod) entry.lastmod = String(s.lastmod);
    return entry;
  });
}

async function parseSitemap(
  xml: string,
  followIndex: boolean,
  limit: number
): Promise<{
  urls: SitemapUrl[];
  url_count: number;
  is_index: boolean;
  sitemaps: SitemapEntry[];
}> {
  const parsed = parser.parse(xml);

  // Check if it's a sitemap index
  if (parsed.sitemapindex) {
    const sitemaps = parseSitemapIndex(parsed);
    let allUrls: SitemapUrl[] = [];

    if (followIndex && sitemaps.length > 0) {
      console.error(`Found sitemap index with ${sitemaps.length} child sitemap(s), following...`);

      for (const sm of sitemaps) {
        if (allUrls.length >= limit) break;

        try {
          console.error(`Fetching child sitemap: ${sm.loc}`);
          const childXml = await fetchXml(sm.loc);
          const childParsed = parser.parse(childXml);
          const childUrls = parseUrlset(childParsed);
          allUrls.push(...childUrls);
        } catch (err: any) {
          console.error(`Failed to fetch child sitemap ${sm.loc}: ${err.message}`);
        }
      }

      // Respect limit
      if (allUrls.length > limit) {
        allUrls = allUrls.slice(0, limit);
      }
    }

    return {
      urls: allUrls,
      url_count: allUrls.length,
      is_index: true,
      sitemaps,
    };
  }

  // Regular urlset sitemap
  let urls = parseUrlset(parsed);
  if (urls.length > limit) {
    urls = urls.slice(0, limit);
  }

  return {
    urls,
    url_count: urls.length,
    is_index: false,
    sitemaps: [],
  };
}

try {
  const input = await Bun.stdin.json();

  const url: string | undefined = input.url;
  const content: string | undefined = input.content;
  const followIndex: boolean = input.follow_index !== false; // default true
  const limit: number = input.limit || 1000;

  let xml: string;

  if (content) {
    console.error("Parsing provided XML content");
    xml = content;
  } else if (url) {
    const normalizedUrl = normalizeUrl(url);
    console.error(`Fetching sitemap from ${normalizedUrl}`);
    xml = await fetchXml(normalizedUrl);
  } else {
    throw new Error("Missing required parameter: url or content");
  }

  const result = await parseSitemap(xml, followIndex, limit);

  console.error(`Found ${result.url_count} URL(s)${result.is_index ? ` from sitemap index (${result.sitemaps.length} child sitemaps)` : ""}`);
  console.log(JSON.stringify(result));
} catch (err: any) {
  console.error(err.message);
  console.log(JSON.stringify({ error: err.message }));
}
