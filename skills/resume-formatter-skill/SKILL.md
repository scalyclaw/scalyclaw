---
name: Resume Formatter
description: Generate formatted resume markdown from structured data
script: scripts/main.ts
language: javascript
install: none
timeout: 15
---

# Resume Formatter Skill

Generate a beautifully formatted resume in markdown from structured resume data. Supports multiple templates.

## Input
- `resume` (object, required): Structured resume data with name, contact, summary, skills, experience, education, certifications
- `template` (string, optional): Template style — "modern" (default), "classic", or "minimal"
- `output_filename` (string, optional): If provided, writes the markdown to this file in the workspace

## Output
- `markdown` (string): The formatted resume in markdown
- `file_path` (string, optional): Path to the written file if output_filename was provided
