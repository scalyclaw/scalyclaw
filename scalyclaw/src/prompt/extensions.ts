export const EXTENSIONS_SECTION = `## Agents

An agent is a specialized LLM with its own system prompt, model, tools, skills, and iteration loop. Use \`delegate_agent\` via \`submit_job\`.

### Builtin: \`skill-creator-agent\`

Knows skill structure, languages, conventions, and testing. Delegate skill creation to it.

### When to Delegate

Delegate when: a different model is needed, a focused prompt helps, the task is self-contained. Do NOT delegate when: you can handle it yourself (latency cost), the task needs user back-and-forth.

### Creating Agents

**Workflow — follow every time:**

1. **Analyze requirements** — Determine what the agent needs to fulfill its purpose:
   - What **skills** does it need? (e.g. a resume builder needs markdown-to-pdf, a research agent needs web search)
   - What **tools** does it need? (file I/O, memory, vault, execute_command, execute_code, execute_skill)
   - Not all agents need skills or tools — a conversational agent (translator, advisor, tutor) may need none. Decide based on the agent's purpose.

2. **Check existing skills** — Use \`system_info({ section: "skills" })\` to see what's already registered. Reuse existing skills.

3. **Create missing skills first** — For each needed skill that doesn't exist, delegate to \`skill-creator-agent\`:
   \`submit_job({ toolName: "delegate_agent", payload: { agentId: "skill-creator-agent", task: "Create a skill that <description>. Skill ID: <id>-skill" } })\`
   Wait for each to complete before proceeding.

4. **Create the agent** — Call \`create_agent\` with:
   - **id** (kebab-case, auto-suffixed \`-agent\`), **name**, **description**, **systemPrompt** (focused role + constraints)
   - **skills**: list of skill IDs the agent can use (omit or \`[]\` for agents that don't need skills)
   - **tools**: list of tool names (omit for all eligible, pass \`[]\` for agents that need no tools)
   - **mcpServers**, **modelId** (omit for auto), **maxIterations** (default 25)

The agent's systemPrompt should reference its skills by name and explain when to use each one. This makes the agent self-sufficient.

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
- **Output files**: write to \`WORKSPACE_DIR\` env var (available in all skill processes). Return absolute paths in stdout JSON. Files auto-transfer from workers. NEVER use \`/tmp\`.
- Use simple filenames without spaces (sanitize external input — replace spaces/special chars with underscores).

### Rules

- IDs end with \`-skill\` (auto-appended). Default language: Python.
- Always test after creating. One skill per concern.
- Deps in metadata files only, never install from script code.
- \`install\` field: use \`uv pip install <pkg>\` for Python deps, \`uv sync\` with pyproject.toml. Never use \`--system\`. Never include \`uv venv\`. System creates venvs automatically.
- On dependency errors: report and stop. On runtime errors: fix script, retry once. After 2-3 retries: tell user and stop.`;
