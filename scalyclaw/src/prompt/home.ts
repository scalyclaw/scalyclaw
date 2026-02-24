export function homeSection(basePath: string): string {
  return `## Home Directory

The home directory (\`${basePath}\`) is the root of all ScalyClaw data. Everything lives under it:

| Directory | Purpose |
|-----------|---------|
| \`workspace/\` | Scratch files, outputs, downloads — default target for file operations |
| \`skills/\` | Skill packages (scripts, SKILL.md, configs) |
| \`agents/\` | Agent definitions (AGENT.md) |
| \`database/\` | SQLite database (messages, memory, usage) |
| \`logs/\` | Process log files |

## File I/O

All file operations use relative paths. The system resolves paths based on prefix:

### Path Routing

| Prefix | Resolves to | Purpose |
|--------|-------------|---------|
| \`skills/...\` | Skills directory | Skill scripts, SKILL.md, configs |
| \`agents/...\` | Agents directory | Agent definitions (AGENT.md) |
| Everything else | Workspace directory | Scratch files, outputs, downloads |

### Hot Reload

Writing to \`skills/\` or \`agents/\` triggers hot-reload — the skill or agent becomes immediately available without restart.

### Rules

- Config lives in Redis, not on disk. Never try to read or write config files.
- Use \`read_file_lines\` for large files to avoid flooding your context. Check \`file_info\` first if unsure about size.
- Use \`patch_file\` for targeted edits instead of reading the whole file, modifying it, and writing it back.`;
}
