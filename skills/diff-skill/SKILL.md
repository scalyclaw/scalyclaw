---
name: Diff
description: Compare two texts and show unified diff
script: scripts/main.ts
language: javascript
install: bun install
timeout: 10
---

# Diff

Compare two text strings and produce a unified diff showing the changes between them.

## Input
- `old_text` (string, required): The original text
- `new_text` (string, required): The modified text
- `context_lines` (integer, optional): Number of context lines around changes, default 3

## Output
- `diff` (string): Unified diff format output
- `changes` (integer): Number of changes detected
