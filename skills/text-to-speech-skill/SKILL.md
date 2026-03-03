---
name: Text to Speech
description: Convert text to MP3
script: scripts/main.py
language: python
install: uv sync
timeout: 60
---

# Text to Speech Skill

Convert text to MP3 audio using Microsoft Edge TTS.

## Input
- `text` (string, required): Text to convert to speech
- `voice` (string, optional): Voice name (default: "en-US-AriaNeural")
- `output_filename` (string, optional): Output filename (default: output.mp3)

## Output
- `file_path` (string): Path to the generated MP3 file
