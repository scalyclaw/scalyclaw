---
name: Image Processor
description: Resize, crop, rotate, convert, watermark images
script: scripts/main.py
language: python
install: uv sync
timeout: 30
---

# Image Processor Skill

Process images with various operations: resize, crop, rotate, convert, and watermark.

## Input
- `file_path` (string, required): Path to the input image
- `operation` (string, required): One of "resize", "crop", "rotate", "convert", "watermark"
- `params` (object, required): Operation-specific parameters:
  - resize: `width` (int), `height` (int)
  - crop: `box` (array of 4 ints: [left, top, right, bottom])
  - rotate: `angle` (number, degrees)
  - convert: `format` (string: "PNG", "JPEG", "WEBP", "BMP", "GIF")
  - watermark: `text` (string)
- `output_filename` (string, optional): Output filename

## Output
- `file_path` (string): Path to the processed image
- `width` (number): Output image width
- `height` (number): Output image height
- `format` (string): Output image format
