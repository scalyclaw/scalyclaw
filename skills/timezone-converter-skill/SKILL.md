---
name: Timezone Converter
description: Convert times between timezones, show world clock, and list timezone offsets
script: scripts/main.ts
language: javascript
install: bun install
timeout: 10
---

# Timezone Converter

Convert times between timezones, list timezone offsets, and show "world clock" for multiple zones.

## Input
- `action` (string, optional): "convert", "now", or "list" — default "convert"

### For "convert"
- `time` (string, required): ISO 8601 datetime or time string (e.g. "2024-01-15T09:00:00", "14:30")
- `from_timezone` (string, required): Source timezone (e.g. "America/New_York", "UTC", "EST")
- `to_timezone` (string or array of strings, required): Target timezone(s)

### For "now"
- `timezones` (array of strings, required): List of timezones to show current time for

### For "list"
- `filter` (string, optional): Filter timezone names (e.g. "America", "Europe")

## Output (convert)
- `original` (object): `{ time, timezone, offset }`
- `converted` (array): `[{ time, timezone, offset, date, day_of_week }]`

## Output (now)
- `times` (array): `[{ timezone, time, date, offset, day_of_week }]`

## Output (list)
- `timezones` (array): `[{ name, offset, abbreviation }]`
