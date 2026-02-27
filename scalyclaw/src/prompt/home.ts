export function homeSection(basePath: string): string {
  return `## Home Directory

The home directory (\`${basePath}\`) is the root of all ScalyClaw data. All file operations use home-relative paths.

| Directory | Purpose | Hot Reload |
|-----------|---------|------------|
| \`skills/\` | Skill packages (scripts, SKILL.md, configs) | Yes |
| \`agents/\` | Agent definitions (AGENT.md) | Yes |
| \`mind/\` | Identity and reference documents | — |
| \`workspace/\` | Scratch files, outputs, downloads | — |
| \`logs/\` | Process log files | — |
| \`database/\` | SQLite database (messages, memory, usage) | — |

### Rules

- Use \`list_directory\` to browse directories (e.g. \`skills\`, \`agents\`, \`mind\`, \`logs\`).
- Config lives in Redis, not on disk. Never try to read or write config files.
- Use \`read_file_lines\` for large files to avoid flooding your context. Check \`file_info\` first if unsure about size.
- Use \`patch_file\` for targeted edits instead of reading the whole file, modifying it, and writing it back.`;
}
