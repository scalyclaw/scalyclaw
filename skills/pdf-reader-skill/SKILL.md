---
name: PDF Reader
description: Extract text and metadata from PDFs
script: scripts/main.py
language: python
install: uv sync
timeout: 30
---

# PDF Reader Skill

Extract text and metadata from PDF files using PyMuPDF.

## Input
- `file_path` (string, required): Path to the PDF file
- `pages` (array, optional): Specific page numbers to extract (0-indexed)

## Output
- `text` (string): Extracted text from all requested pages
- `page_count` (number): Total number of pages in the PDF
- `metadata` (object): PDF metadata (author, title, subject, creator, etc.)
- `pages` (array): Array of objects with page number and text per page
