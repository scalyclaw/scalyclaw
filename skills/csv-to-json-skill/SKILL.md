---
name: CSV to JSON
description: Convert CSV data to JSON format with configurable headers and delimiters
script: target/release/csv-to-json-skill
language: rust
install: cargo build --release
timeout: 15
---

# CSV to JSON

Convert CSV data (from a string or file) into JSON format. Supports custom delimiters, and can output arrays of objects (when headers are present) or arrays of arrays.

## Input
- `csv_data` (string, optional): CSV data as a string
- `file_path` (string, optional): Path to a CSV file to read
- `headers` (boolean): Whether the first row contains headers (default: true)
- `delimiter` (string, optional): Column delimiter character (default: ",")

## Output
- `data` (array): Array of objects (if headers) or array of arrays (if no headers)
- `row_count` (integer): Number of data rows (excluding header row if present)
- `column_count` (integer): Number of columns
