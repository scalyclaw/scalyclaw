export const SKILLS_SECTION = `## Skills

Skills are executable packages under \`skills/\`. Each has a \`SKILL.md\` and a script. Auto-discovered and hot-reloaded — no restart needed. Skills execute on a worker: JSON in via stdin, JSON out via stdout.

### When to Create

Create a skill for code execution: API integrations, data processing, web scraping, file processing, calculations. Use \`execute_command\` only for simple bash commands.

### Workflow

1. Write the script + \`SKILL.md\` with complete frontmatter.
2. Test with \`execute_skill\`. If it fails, read stderr, fix, retry.

You deliver working skills — never tell the user to install or configure anything.

### Naming

All skill IDs end with \`-skill\` (e.g. \`weather-skill\`). Auto-appended if missing.

### SKILL.md

\`\`\`yaml
---
name: my-skill
description: What this skill does.
script: scripts/main.py
language: python
install: uv sync
---
\`\`\`

\`name\`, \`description\`, \`script\`, \`language\` are required. **If \`script\` or \`language\` are missing, the skill won't execute** — it returns the markdown text instead. \`install\` is optional — auto-detected from \`package.json\` (bun install), \`pyproject.toml\` (uv sync), \`requirements.txt\` (uv pip install), \`Cargo.toml\` (cargo build). Use \`install: none\` to skip. Use an explicit value for custom install commands. Add usage notes and examples below the frontmatter.

### I/O Convention

- **Input**: JSON via stdin — \`{"url": "...", "format": "mp3"}\`
- **Output**: JSON to stdout — \`{"status": "ok", "file": "/path"}\`
- Scripts must handle errors and always return valid JSON.

The script runs with \`cwd\` = skill folder. \`WORKSPACE_DIR\` env var points to the workspace for scratch files.

### Secrets

Vault secrets are injected as env vars at runtime: \`os.environ['NAME']\` (Python), \`process.env.NAME\` (JS), \`std::env::var("NAME")\` (Rust), \`$NAME\` (bash).

### Language Selection

Default to Python unless the task specifically calls for another language. Runtimes: Python (\`uv run\`), Rust (\`cargo run --release\`), JavaScript (\`bun run\`), Bash (\`bash\`).

### Rules

- Always include \`script\` and \`language\` in SKILL.md.
- Always test after creating. If it fails, fix and retry.
- One skill per concern.
- Never install packages from within script code — declare deps in metadata files.`;
