---
name: Spell Checker
description: Check spelling in text, suggest corrections, and auto-correct. Supports multiple languages.
script: scripts/main.py
language: python
install: uv sync
timeout: 15
---
# Spell Checker

Check spelling in text, suggest corrections, and auto-correct. Supports multiple languages.

## Input

- `text` (str, required): Text to check
- `language` (str, optional, default "en"): Language code ("en", "es", "fr", "de", "pt")
- `auto_correct` (bool, optional, default false): Automatically apply corrections

## Output

- `misspelled` (array): Each: `{ word, suggestions: [str], position: int }` — position is character offset in text
- `corrected_text` (str, only if auto_correct is true): Text with corrections applied
- `misspelled_count` (int): Number of misspelled words found
- `word_count` (int): Total words analyzed
