---
name: YouTube Transcript
description: Get video transcripts
script: scripts/main.py
language: python
install: uv sync
timeout: 30
---

# YouTube Transcript Skill

Fetch transcripts/subtitles from YouTube videos.

## Input
- `video_id` (string): YouTube video ID (or use `url`)
- `url` (string): Full YouTube URL (alternative to video_id)
- `language` (string, optional): Language code (default: "en")

## Output
- `transcript` (array): Array of segments with text, start, duration
- `full_text` (string): Concatenated transcript text
