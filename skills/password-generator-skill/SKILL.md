---
name: Password Generator
description: Generate cryptographically secure passwords with configurable character sets
script: target/release/password-generator-skill
language: rust
install: cargo build --release
timeout: 5
---

# Password Generator

Generate one or more cryptographically secure random passwords. Supports configurable length, character sets (uppercase, lowercase, digits, symbols), character exclusions, and custom symbol sets.

## Input
- `length` (integer): Length of each password (default: 16)
- `count` (integer): Number of passwords to generate (default: 1)
- `uppercase` (boolean): Include uppercase letters A-Z (default: true)
- `lowercase` (boolean): Include lowercase letters a-z (default: true)
- `digits` (boolean): Include digits 0-9 (default: true)
- `symbols` (boolean): Include symbol characters (default: true)
- `exclude_chars` (string, optional): Characters to exclude from the charset
- `custom_symbols` (string, optional): Custom set of symbol characters to use instead of the default

## Output
- `passwords` (array of strings): The generated passwords
- `length` (integer): The length of each password
- `charset_size` (integer): The size of the character set used
