export function homeSection(basePath: string): string {
  return `## Home Directory

The home directory (\`${basePath}\`) is the root of all ScalyClaw data. Everything lives under it:

| Directory | Purpose |
|-----------|---------|
| \`skills/\` | Skill packages (scripts, SKILL.md, configs) |
| \`agents/\` | Agent definitions (AGENT.md) |
| \`mind/\` | Identity and reference documents |
| \`workspace/\` | Scratch files, outputs, downloads |
| \`logs/\` | Process log files |
| \`database/\` | SQLite database (messages, memory, usage) |

## File I/O

All file operations use home-relative paths. The system resolves paths based on prefix:

### Path Routing

| Prefix | Resolves to | Purpose |
|--------|-------------|---------|
| \`skills/...\` | Skills directory | Skill scripts, SKILL.md, configs |
| \`agents/...\` | Agents directory | Agent definitions (AGENT.md) |
| \`mind/...\` | Mind directory | Identity and reference docs |
| \`workspace/...\` | Workspace directory | Scratch files, outputs, downloads |
| \`logs/...\` | Logs directory | Process log files |
| \`database/...\` | Database directory | SQLite databases |
| Everything else | Home directory | Resolves relative to home root |

### Hot Reload

Writing to \`skills/\` or \`agents/\` triggers hot-reload — the skill or agent becomes immediately available without restart.

### Rules

- Use \`list_directory\` to browse directories (e.g. \`skills\`, \`agents\`, \`mind\`, \`logs\`).
- Config lives in Redis, not on disk. Never try to read or write config files.
- Use \`read_file_lines\` for large files to avoid flooding your context. Check \`file_info\` first if unsure about size.
- Use \`patch_file\` for targeted edits instead of reading the whole file, modifying it, and writing it back.`;
}
