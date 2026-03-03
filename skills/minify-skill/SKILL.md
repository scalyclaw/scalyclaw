---
name: Code Minify/Beautify
description: Minify or beautify JS, CSS, HTML, JSON
script: scripts/main.ts
language: javascript
install: bun install
timeout: 15
---

# Code Minify/Beautify

Minify or beautify JavaScript, CSS, HTML, and JSON code. Reports size savings for minification.

## Input
- `code` (string, required): The source code to process
- `language` (string, required): "js", "css", "html", or "json"
- `action` (string, required): "minify" or "beautify"

## Output
- `result` (string): The processed code
- `original_size` (integer): Original code size in bytes
- `result_size` (integer): Result code size in bytes
- `savings_percent` (number): Percentage of size reduction (for minify)
