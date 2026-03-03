---
name: PDF Merger & Splitter
description: Merge multiple PDFs into one, split a PDF into individual pages, or extract specific page ranges.
script: scripts/main.py
language: python
install: uv sync
timeout: 30
---
# PDF Merger & Splitter

Merge multiple PDFs into one, split a PDF into individual pages, or extract specific page ranges.

## Input

- `action` (str, required): "merge", "split", or "extract"
- For "merge":
  - `file_paths` (array of str, required): PDFs to merge in order
  - `output_filename` (str, optional, default "merged.pdf"): Name of the merged output file
- For "split":
  - `file_path` (str, required): PDF to split into individual pages
- For "extract":
  - `file_path` (str, required): Source PDF
  - `pages` (array of int, required): Page numbers to extract (1-indexed)
  - `output_filename` (str, optional, default "extracted.pdf"): Name of the extracted output file

## Output

- For "merge": `{ file_path, page_count }` — path to merged PDF
- For "split": `{ files: [{ file_path, page_number }], page_count }` — one PDF per page
- For "extract": `{ file_path, page_count }` — path to extracted PDF
