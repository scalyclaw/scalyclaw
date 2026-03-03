---
name: HTML to Markdown
description: Convert HTML to clean Markdown
script: scripts/main.ts
language: javascript
install: bun install
timeout: 15
---

# HTML to Markdown

Convert HTML content or fetch a URL and convert its HTML to clean Markdown format.

## Input
- `html` (string, optional): HTML content to convert
- `url` (string, optional): URL to fetch HTML from and convert

## Output
- `markdown` (string): The converted Markdown content
