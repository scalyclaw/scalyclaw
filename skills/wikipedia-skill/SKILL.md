---
name: Wikipedia
description: Search and retrieve Wikipedia articles
script: scripts/main.py
language: python
install: uv sync
timeout: 15
---

# Wikipedia Skill

Search and retrieve Wikipedia articles with summaries and full text.

## Input
- `query` (string, required): Search query or article title
- `language` (string, optional): Wikipedia language code (default: "en")
- `summary_only` (boolean, optional): Return only summary (default: true)

## Output
- `title` (string): Article title
- `summary` (string): Article summary
- `text` (string): Full article text (if summary_only is false)
- `url` (string): URL to the Wikipedia article
- `categories` (array): List of article categories
