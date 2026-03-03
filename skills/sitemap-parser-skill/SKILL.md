---
name: Sitemap Parser
description: Parse XML sitemaps to discover all pages on a website
script: scripts/main.ts
language: javascript
install: bun install
timeout: 30
---

# Sitemap Parser

Parse XML sitemaps to discover all pages on a website. Supports sitemap index files and nested sitemaps.

## Input
- `url` (string, optional): URL of the sitemap (auto-tries /sitemap.xml if just a domain is given)
- `content` (string, optional): Raw XML sitemap content to parse directly
- `follow_index` (boolean, optional): Follow sitemap index files to child sitemaps — default true
- `limit` (number, optional): Max URLs to return — default 1000

## Output
- `urls` (array): `[{ loc, lastmod?, changefreq?, priority? }]`
- `url_count` (number): Total number of URLs found
- `is_index` (boolean): Whether the input was a sitemap index file
- `sitemaps` (array, if index): `[{ loc, lastmod? }]` — child sitemaps found
