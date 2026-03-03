---
name: YAML/JSON/TOML Converter
description: Convert between YAML, JSON, and TOML configuration formats
script: target/release/yaml-json-converter-skill
language: rust
install: cargo build --release
timeout: 10
---
# YAML/JSON/TOML Converter

Convert configuration content between YAML, JSON, and TOML formats.

## Input

- `content` (string, required): The input content to convert
- `from_format` (string, required): Source format — "yaml", "json", "toml"
- `to_format` (string, required): Target format — "yaml", "json", "toml"
- `pretty` (bool, optional, default true): Pretty-print the output

## Output

- `result` (string): The converted content
- `from_format` (string): Confirmed source format
- `to_format` (string): Confirmed target format

## Examples

Convert YAML to JSON:
```json
{ "content": "name: test\nversion: 1.0", "from_format": "yaml", "to_format": "json" }
```

Convert JSON to TOML:
```json
{ "content": "{\"name\": \"test\", \"version\": \"1.0\"}", "from_format": "json", "to_format": "toml" }
```

## Notes

- TOML requires a table/object at the root level. Arrays or scalar values at the root will produce an error.
- Pretty-printing is enabled by default. Set `pretty` to false for compact output.
