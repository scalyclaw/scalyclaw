---
name: Git Repository Info
description: Get git repository information including log, diff, branch info, blame, and commit details
script: scripts/main.sh
language: bash
install: none
timeout: 15
---
# Git Repository Info

Query git repository information using read-only git commands. Supports log, diff, branches, status, blame, and show actions.

## Input

- `action` (string, required): One of "log", "diff", "branches", "status", "blame", "show"
- `path` (string, optional): File path for blame/diff operations
- `count` (int, optional, default 10): Number of log entries to return
- `ref` (string, optional): Git ref (branch, tag, commit hash) for log/show
- `from_ref` (string, optional): Start ref for diff (e.g. "HEAD~3")
- `to_ref` (string, optional): End ref for diff (default "HEAD")

## Output (varies by action)

- **log**: `{ commits: [{ hash, short_hash, author, date, message }] }`
- **diff**: `{ diff, files_changed, insertions, deletions }`
- **branches**: `{ current, branches: [...] }`
- **status**: `{ branch, clean, staged, modified, untracked }`
- **blame**: `{ lines: [{ hash, author, date, line_number, content }] }` (first 200 lines)
- **show**: `{ hash, author, date, message, diff }`

## Examples

Get recent commits:
```json
{ "action": "log", "count": 5 }
```

Get diff between refs:
```json
{ "action": "diff", "from_ref": "HEAD~3", "to_ref": "HEAD" }
```

Blame a file:
```json
{ "action": "blame", "path": "src/main.rs" }
```

## Notes

- All git commands are read-only (no checkout, commit, push, etc.)
- The working directory is set by the system to the target repository
