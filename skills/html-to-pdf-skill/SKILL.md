---
name: HTML to PDF
description: Convert a full HTML+CSS document to PDF
script: scripts/main.ts
language: javascript
install: bun install
timeout: 60
---

# HTML to PDF Skill

Convert a complete HTML+CSS document to a PDF file via Puppeteer.

## Input
- `html` (string, required): Complete HTML document with embedded CSS
- `output_filename` (string, optional): Output PDF filename (default: "output.pdf")

## Output
- `file_path` (string): Path to the generated PDF file
