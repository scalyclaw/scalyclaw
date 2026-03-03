import Parser from "rss-parser";

try {
  const data = await Bun.stdin.json();
  const url: string = data.url;
  const limit: number = data.limit ?? 20;

  if (!url) {
    throw new Error("Missing required parameter: url");
  }

  console.error(`Fetching RSS feed: ${url}`);

  const parser = new Parser({
    timeout: 10000,
    headers: {
      "User-Agent": "ScalyClaw-RSS-Reader/1.0",
      Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml",
    },
  });

  const feed = await parser.parseURL(url);

  const items = feed.items.slice(0, limit).map((item) => ({
    title: item.title || null,
    link: item.link || null,
    pubDate: item.pubDate || item.isoDate || null,
    content: item.contentSnippet || item.content || null,
    author: item.creator || item.author || null,
    categories: item.categories || [],
  }));

  const result = {
    title: feed.title || null,
    description: feed.description || null,
    link: feed.link || null,
    language: feed.language || null,
    lastBuildDate: feed.lastBuildDate || null,
    item_count: items.length,
    items,
  };

  console.log(JSON.stringify(result));
} catch (err: any) {
  console.error(err.message);
  console.log(JSON.stringify({ error: err.message }));
}
