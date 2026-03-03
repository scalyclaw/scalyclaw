---
name: Cron Expression Parser
description: Parse, explain, and calculate next execution times for cron expressions
script: scripts/main.ts
language: javascript
install: bun install
timeout: 10
---

# Cron Expression Parser

Parse cron expressions, generate human-readable descriptions, and calculate upcoming execution times. Essential for DevOps and scheduling tasks.

## Input
- `expression` (string, required): Cron expression (5 or 6 fields, supports standard and extended syntax)
- `count` (integer, optional, default 5): Number of next execution times to calculate
- `timezone` (string, optional, default "UTC"): Timezone for calculations (e.g. "America/New_York")
- `from` (string, optional): Start date for calculations (ISO 8601), defaults to now

## Output
- `expression` (string): The input expression
- `description` (string): Human-readable description of the cron schedule
- `next_runs` (array of string): Next N execution times as ISO 8601 strings
- `fields` (object): Parsed fields — `{ minute, hour, day_of_month, month, day_of_week }` each as string
- `is_valid` (boolean): Whether the expression is valid
