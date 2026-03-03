---
name: QR Code
description: Generate and decode QR codes
script: scripts/main.ts
language: javascript
install: bun install
timeout: 15
---

# QR Code

Generate QR code images from text and decode QR codes from image files.

## Input
- `action` (string, required): "generate" or "decode"
- `text` (string, required for generate): Text to encode in the QR code
- `file_path` (string, required for decode): Path to image file containing QR code
- `output_filename` (string, optional): Output PNG filename for generated QR codes

## Output (generate)
- `file_path` (string): Path to the generated QR code PNG image

## Output (decode)
- `text` (string): Decoded content from the QR code
