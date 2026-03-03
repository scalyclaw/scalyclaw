---
name: OCR
description: Extract text from images using Tesseract OCR
script: scripts/main.py
language: python
install: uv sync
timeout: 30
---

# OCR Skill

Extract text from images including receipts, screenshots, documents, and photos of text using Tesseract OCR.

## Input
- `file_path` (string, required): Path to image file (PNG, JPG, TIFF, BMP, WebP)
- `language` (string, optional, default "eng"): Tesseract language code (e.g. "eng", "fra", "deu", "eng+fra" for multiple)
- `psm` (integer, optional, default 3): Page segmentation mode (3=auto, 6=single block, 7=single line, 11=sparse text)

## Output
- `text` (string): Extracted text
- `confidence` (float): Average confidence score (0-100)
- `line_count` (integer): Number of text lines
- `word_count` (integer): Number of words
