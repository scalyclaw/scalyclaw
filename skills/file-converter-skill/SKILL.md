---
name: File Converter
description: Convert between file formats (DOCX, Markdown, XLSX, CSV, HTML, JSON, YAML)
script: scripts/main.py
language: python
install: uv sync
timeout: 30
---

# File Converter Skill

Convert between common file formats: DOCX to/from Markdown, XLSX to CSV, HTML to text/markdown, JSON to/from YAML, CSV to JSON.

## Input
- `file_path` (string, optional): Path to input file
- `content` (string, optional): Raw content to convert (alternative to file_path)
- `from_format` (string, required): Source format ("docx", "xlsx", "html", "json", "yaml", "markdown", "csv")
- `to_format` (string, required): Target format ("markdown", "csv", "json", "yaml", "html", "text", "docx")
- `output_filename` (string, optional): Custom output filename

## Output
- `file_path` (string): Path to converted file (for file-based outputs)
- `content` (string): Converted content (for text-based outputs)
- `from_format` (string): Confirmed source format
- `to_format` (string): Confirmed target format
