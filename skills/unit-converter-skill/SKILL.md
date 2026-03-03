---
name: Unit Converter
description: Convert between measurement units across length, weight, temperature, volume, area, speed, data storage, and time
script: target/release/unit-converter-skill
language: rust
install: cargo build --release
timeout: 5
---

# Unit Converter

Convert between measurement units: length, weight, temperature, volume, area, speed, data storage, and time.

## Input
- `value` (float, required): Number to convert
- `from` (string, required): Source unit (e.g. "km", "miles", "kg", "lbs", "celsius", "fahrenheit", "GB", "MB")
- `to` (string, required): Target unit
- `category` (string, optional): Category hint if ambiguous

## Output
- `value` (float): Original value
- `result` (float): Converted value (rounded to 6 decimal places)
- `from` (string): Source unit name
- `to` (string): Target unit name
- `category` (string): Which category was used
- `formula` (string): Human-readable conversion formula
