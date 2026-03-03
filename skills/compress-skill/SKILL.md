---
name: Compress
description: Create and extract ZIP and tar.gz archives
script: scripts/main.ts
language: javascript
install: bun install
timeout: 30
---

# Compress

Create and extract ZIP and tar.gz archives. Outputs files to WORKSPACE_DIR.

## Input
- `action` (string, required): "compress" or "extract"

### For "compress"
- `file_paths` (array of strings, required): Files/directories to include
- `format` (string, optional): "zip" or "tar.gz" — default "zip"
- `output_filename` (string, optional): Output archive filename

### For "extract"
- `file_path` (string, required): Path to archive file
- `output_dir` (string, optional): Where to extract (defaults to WORKSPACE_DIR)

## Output (compress)
- `file_path` (string): Path to created archive
- `file_count` (number): Number of files included
- `total_size` (number): Archive size in bytes

## Output (extract)
- `output_dir` (string): Extraction directory
- `files` (array of strings): Extracted file paths
- `file_count` (number): Number of extracted files
