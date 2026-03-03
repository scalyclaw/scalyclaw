---
name: Audio Transcriber
description: Transcribe audio and video files to text using OpenAI Whisper
script: scripts/main.py
language: python
install: uv sync
timeout: 300
---

# Audio Transcriber Skill

Transcribe audio or video files to text using OpenAI Whisper (runs locally, no API key required).

**Note**: The first run downloads the selected model (~140MB for "base"). Requires ffmpeg installed on the system.

## Input
- `file_path` (string, required): Path to audio/video file (mp3, wav, m4a, mp4, webm, etc.)
- `model` (string, optional, default "base"): Whisper model size ("tiny", "base", "small", "medium", "large")
- `language` (string, optional): Language code (e.g. "en", "fr") — auto-detected if omitted
- `timestamps` (boolean, optional, default false): Include word/segment timestamps in output

## Output
- `text` (string): Full transcribed text
- `language` (string): Detected language
- `segments` (array, if timestamps=true): Array of objects with `start`, `end`, `text` fields
- `duration` (float): Audio duration in seconds
