---
name: Translator
description: Translate text between languages
script: scripts/main.py
language: python
install: uv sync
timeout: 15
---

# Translator Skill

Translate text between languages using deep-translator.

## Input
- `text` (string, required): Text to translate
- `source` (string, optional): Source language code (default: "auto")
- `target` (string, required): Target language code (e.g., "fr", "es", "de", "ja")

## Output
- `translated_text` (string): The translated text
- `source_language` (string): Source language used
- `target_language` (string): Target language used
