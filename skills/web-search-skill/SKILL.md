---
name: Web Search
description: Search the web using DuckDuckGo
script: scripts/main.py
language: python
install: uv sync
timeout: 30
---

# Web Search Skill

Search the web using DuckDuckGo and return structured results.

## Input
- `query` (string, required): Search query
- `max_results` (number, optional): Maximum results to return (default: 10)

## Output
- `results` (array): Array of search results with title, url, snippet
