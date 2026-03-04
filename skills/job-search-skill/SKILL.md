---
name: Job Search
description: Search job listings via DuckDuckGo
script: scripts/main.py
language: python
install: uv sync
timeout: 30
---

# Job Search Skill

Search for job listings using DuckDuckGo with job-optimized queries.

## Input
- `query` (string, required): Job search query (e.g. "Python developer", "data scientist")
- `location` (string, optional): Location filter (e.g. "New York", "remote")
- `job_type` (string, optional): Job type filter (e.g. "full-time", "contract", "remote")
- `max_results` (number, optional): Maximum results to return (default: 10)

## Output
- `results` (array): Array of job listings with title, company, location, url, snippet, source
