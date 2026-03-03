---
name: Hash Generator
description: Generate cryptographic hashes (SHA-256, SHA-512, BLAKE3, MD5) for text or files
script: target/release/hash-skill
language: rust
install: cargo build --release
timeout: 10
---

# Hash Generator

Generate cryptographic hashes for text strings or file contents. Supports SHA-256, SHA-512, BLAKE3, and MD5 algorithms. Can compute a single algorithm or all at once.

## Input
- `text` (string, optional): Text string to hash
- `file_path` (string, optional): Path to a file whose contents should be hashed
- `algorithm` (string): Hash algorithm to use: "sha256", "sha512", "blake3", "md5", or "all" (default: "all")

## Output
- `hashes` (object): Object with algorithm names as keys and hex digest strings as values
- `algorithm` (string): The algorithm(s) used
- `input_size` (integer): Size of the input in bytes
