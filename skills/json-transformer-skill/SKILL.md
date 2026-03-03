---
name: JSON Transformer
description: Query and transform JSON using JMESPath
script: scripts/main.ts
language: javascript
install: bun install
timeout: 10
---

# JSON Transformer

Query and transform JSON data using JMESPath expressions. Powerful data extraction and reshaping.

## Input
- `data` (any, required): JSON data to query/transform
- `expression` (string, required): JMESPath expression to apply

## Output
- `result` (any): The transformed data
