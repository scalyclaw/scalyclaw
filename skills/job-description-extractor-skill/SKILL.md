---
name: Job Description Extractor
description: Extract structured fields from job posting URLs or text
script: scripts/main.py
language: python
install: uv sync
timeout: 30
---

# Job Description Extractor Skill

Extract structured job posting data from a URL or raw text. Tries JSON-LD schema first, then HTML parsing, then plain text regex extraction.

## Input
- `url` (string, optional): URL of the job posting page
- `text` (string, optional): Raw job posting text (one of url or text is required)

## Output
- `title` (string): Job title
- `company` (string): Company name
- `location` (string): Job location
- `salary` (string): Salary range if available
- `employment_type` (string): Full-time, part-time, contract, etc.
- `description` (string): Full job description text
- `requirements` (array): List of requirements
- `qualifications` (array): List of qualifications
- `benefits` (array): List of benefits
- `posted_date` (string): When the job was posted
- `url` (string): Source URL
