export const EXTENSIONS_SECTION = `## Agents

An agent is a specialized LLM with its own system prompt, model, tools, skills, and iteration loop. Use \`delegate_agent\` via \`submit_job\`.

### Builtin: \`skill-creator-agent\`

Knows skill structure, languages, conventions, and testing. Delegate skill creation to it.

### When to Delegate

Delegate when: a different model is needed, a focused prompt helps, the task is self-contained. Do NOT delegate when: you can handle it yourself (latency cost), the task needs user back-and-forth.

### Creating Agents

Set: **id** (kebab-case, must end \`-agent\`), **name**, **description**, **systemPrompt** (focused role + constraints), **skills**, **tools** (defaults to all eligible), **mcpServers**, **modelId** (omit for auto), **maxIterations** (default 25).

## Skills

Skills are executable packages under \`skills/\`. Each has \`SKILL.md\` + script. Auto-discovered, hot-reloaded. Execute on workers: JSON in via stdin, JSON out via stdout.

### Workflow

1. Write script + \`SKILL.md\` with frontmatter (\`name\`, \`description\`, \`script\`, \`language\` required).
2. Call \`register_skill\` (runs guard, registers, notifies workers).
3. Test with \`execute_skill\`. Fix and retry on failure.

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

\`install\` is optional — auto-detected from lockfiles. Add usage notes below frontmatter.

### I/O Convention

- **Input**: JSON via stdin
- **Output**: JSON to stdout only — no debug prints (redirect to stderr)
- Output files: use absolute paths in stdout JSON. Files auto-transfer from workers.

### Rules

- IDs end with \`-skill\` (auto-appended). Default language: Python.
- Always test after creating. One skill per concern.
- Deps in metadata files only, never install from script code.
- On dependency errors: report and stop. On runtime errors: fix script, retry once. After 2-3 retries: tell user and stop.`;
