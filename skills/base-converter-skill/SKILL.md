---
name: Base Converter
description: Encode and decode text using Base64, hex, and URL encoding
script: target/release/base-converter-skill
language: rust
install: cargo build --release
timeout: 10
---

# Base Converter

Convert text between different encodings: Base64, hexadecimal, and URL encoding. Supports both encoding and decoding operations.

## Input
- `text` (string): The text to encode or decode
- `operation` (string): The operation to perform: "base64_encode", "base64_decode", "hex_encode", "hex_decode", "url_encode", "url_decode"

## Output
- `result` (string): The encoded or decoded result
- `operation` (string): The operation that was performed
