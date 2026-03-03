---
name: Screenshot
description: Capture web page screenshots
script: scripts/main.py
language: python
install: uv sync && uv run python -m playwright install chromium
timeout: 60
---

# Screenshot Skill

Capture screenshots of web pages using Playwright and Chromium.

## Input
- `url` (string, required): URL of the web page to screenshot
- `full_page` (boolean, optional): Capture full page (default: false)
- `width` (number, optional): Viewport width in pixels (default: 1280)
- `height` (number, optional): Viewport height in pixels (default: 720)
- `output_filename` (string, optional): Output filename (default: screenshot.png)

## Output
- `file_path` (string): Path to the screenshot PNG file
