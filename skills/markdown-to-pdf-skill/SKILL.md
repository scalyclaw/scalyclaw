---
name: Markdown to PDF
description: Convert Markdown to PDF
script: scripts/main.ts
language: javascript
install: bun install
timeout: 30
---

# Markdown to PDF

Convert Markdown content or Markdown files to PDF documents.

## Input
- `markdown` (string, optional): Markdown content to convert
- `file_path` (string, optional): Path to a Markdown file to convert
- `output_filename` (string, optional): Output PDF filename

## Output
- `file_path` (string): Path to the generated PDF file
