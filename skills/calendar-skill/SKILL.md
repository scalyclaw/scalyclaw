---
name: Calendar
description: Parse iCal files and calculate date ranges
script: scripts/main.ts
language: javascript
install: bun install
timeout: 10
---

# Calendar

Parse iCal/ICS calendar files into structured event data, and calculate date ranges between two dates.

## Input
- `action` (string, required): "parse" or "range"
- `ical_data` (string, optional for parse): Raw iCal data string
- `file_path` (string, optional for parse): Path to an .ics file
- `start_date` (string, for range): Start date (ISO 8601)
- `end_date` (string, for range): End date (ISO 8601)
- `unit` (string, for range): "days", "weeks", or "months"

## Output (parse)
- `events` (array): Events with summary, start, end, location, description

## Output (range)
- `diff` (number): The difference between dates in the specified unit
- `unit` (string): The unit of measurement
- `start` (string): Start date
- `end` (string): End date
