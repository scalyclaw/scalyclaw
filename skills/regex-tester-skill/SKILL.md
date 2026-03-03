---
name: Regex Tester
description: Test regex patterns against text, show all matches with groups and positions
script: target/release/regex-tester-skill
language: rust
install: cargo build --release
timeout: 10
---
# Regex Tester

Test regular expression patterns against text input. Returns all matches with capture groups, positions, and optionally performs regex replacement.

## Input

- `pattern` (string, required): The regex pattern to test
- `text` (string, required): The text to test the pattern against
- `flags` (string, optional): Flags to modify regex behavior — "i" for case-insensitive, "m" for multiline, "s" for dotall. Combine like "im"
- `replace` (string, optional): If provided, perform regex replacement and return the result

## Output

- `is_match` (bool): Whether the pattern matches anywhere in the text
- `match_count` (int): Total number of matches found
- `matches` (array): Each match object contains:
  - `text`: The matched text
  - `start`: Start position in the input text
  - `end`: End position in the input text
  - `groups`: Array of capture groups (index 1+), each with `text`, `start`, `end`, `name`
- `replaced` (string, only if `replace` was provided): The text after replacement

## Examples

Test a pattern:
```json
{ "pattern": "(\\d{4})-(\\d{2})-(\\d{2})", "text": "Date: 2024-01-15 and 2024-02-20" }
```

Replace matches:
```json
{ "pattern": "(\\w+)@(\\w+\\.\\w+)", "text": "Email: user@example.com", "replace": "[$1 at $2]" }
```
