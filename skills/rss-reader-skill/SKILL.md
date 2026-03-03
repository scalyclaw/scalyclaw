---
name: RSS Reader
description: Parse RSS/Atom feeds into structured data
script: scripts/main.ts
language: javascript
install: bun install
timeout: 15
---

# RSS Reader

Parse RSS and Atom feeds into structured JSON data. Supports all common feed formats.

## Input
- `url` (string, required): URL of the RSS/Atom feed
- `limit` (integer, optional): Maximum number of items to return, default 20

## Output
- `title` (string): Feed title
- `description` (string): Feed description
- `items` (array): Feed items with title, link, pubDate, content, author
