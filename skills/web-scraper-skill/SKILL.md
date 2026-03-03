---
name: Web Scraper
description: Extract article text from any URL
script: scripts/main.py
language: python
install: uv sync
timeout: 30
---

# Web Scraper Skill

Extract article text, title, author, and date from any URL using trafilatura.

## Input
- `url` (string, required): The URL to scrape

## Output
- `title` (string): Article title
- `text` (string): Extracted article text
- `author` (string): Article author
- `date` (string): Publication date
- `url` (string): The scraped URL
