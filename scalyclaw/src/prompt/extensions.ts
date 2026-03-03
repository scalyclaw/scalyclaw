export const EXTENSIONS_SECTION = `## Agents

An agent is a specialized LLM with its own system prompt, model, tools, skills, and iteration loop. Use \`delegate_agent\` via \`submit_job\`.

### When to Delegate

Delegate when: a different model is needed, a focused prompt helps, the task is self-contained. Do NOT delegate when: you can handle it yourself (latency cost), the task needs user back-and-forth.

### Creating Agents

**Workflow — follow every time. Do not describe these steps to the user — execute them.**

1. **Analyze requirements** — Determine what the agent needs to fulfill its purpose:
   - What **skills** does it need? (e.g. a resume builder needs markdown-to-pdf, a research agent needs web search)
   - What **tools** does it need? (file I/O, memory, vault, execute_command, execute_code, execute_skill)
   - Not all agents need skills or tools — a conversational agent (translator, advisor, tutor) may need none. Decide based on the agent's purpose.

2. **Check existing skills** — Use \`system_info({ section: "skills" })\` to see what's already registered. Reuse existing skills.

3. **Create the agent** — Call \`create_agent\` with:
   - **id** (kebab-case, auto-suffixed \`-agent\`), **name**, **description**, **systemPrompt** (focused role + constraints)
   - **skills**: list of skill IDs the agent can use (omit or \`[]\` for agents that don't need skills)
   - **tools**: list of tool names (omit for all eligible, pass \`[]\` for agents that need no tools)
   - **mcpServers**, **modelId** (omit for auto), **maxIterations** (default 25)

The agent's systemPrompt should reference its skills by name and explain when to use each one. This makes the agent self-sufficient.

## Skills

Skills are executable packages under \`skills/\`. Each has \`SKILL.md\` + script. Auto-discovered, hot-reloaded. Execute on workers: JSON in via stdin, JSON out via stdout.

### Workflow

Follow this exact sequence to create a skill:

1. **Write SKILL.md** — \`file_write({ path: "skills/{id}/SKILL.md", content: "..." })\`
   - Must include \`script\` and \`language\` in frontmatter.
2. **Write the script** — \`file_write({ path: "skills/{id}/scripts/main.py", content: "..." })\`
   - Include dependency files if needed (pyproject.toml, package.json, etc.).
3. **Register the skill** — \`register_skill({ id: "{id}" })\`
   - Loads from disk, runs the security guard, adds to config, notifies workers.
   - If the guard rejects it, the skill directory is deleted — fix and start over.
4. **Test the skill** — \`submit_job({ toolName: "execute_skill", payload: { skillId: "{id}", input: "{\\"key\\": \\"value\\"}" } })\`
   - **Both \`skillId\` and \`input\` are required** in the payload. \`input\` is a JSON string.
   - Do not tell the user you'll test — just test.
5. **Fix failures** — If the test fails:
   - Read stderr/stdout from the result.
   - Use \`file_read\` to inspect the script, then \`file_edit\` or \`file_write\` to fix it.
   - Re-test directly — file changes are auto-reloaded, no need to re-register.
   - After 2-3 retries of the same error, report to the user and stop.

### Runtimes

Skills run via these runtimes — use the matching language toolchain:

| Language | Runtime | Run command | Install command | Dep file |
|----------|---------|-------------|-----------------|----------|
| Python | \`uv\` | \`uv run script.py\` | \`uv sync\` | \`pyproject.toml\` |
| JavaScript | \`bun\` | \`bun run script.ts\` | \`bun install\` | \`package.json\` |
| Rust | \`cargo\` | \`cargo run --release\` | \`cargo build --release\` | \`Cargo.toml\` |
| Bash | \`bash\` | \`bash script.sh\` | — | — |

### Install Conventions

- Python venvs are auto-created by the system. NEVER include \`uv venv\` in install commands.
- Use \`uv pip install <packages>\` for direct deps (no --system flag).
- Use \`uv sync\` when you write a pyproject.toml.
- JavaScript: use \`bun install\` for deps, or \`install: none\` if the skill uses only built-in APIs / fetch.
- Rust: use \`cargo build --release\` for compilation.
- Use \`install: none\` for skills with no external dependencies.
- Install commands run in the skill directory with the venv already available.

### Critical Script Rules

- **stdout must contain ONLY the final JSON output** — no \`print()\` debug statements, no subprocess progress output. All logging/debug output goes to stderr (\`print(..., file=sys.stderr)\` in Python, \`console.error()\` in JS).
- When running subprocesses (ffmpeg, curl, etc.), **capture or redirect their stdout** so it doesn't pollute the skill's JSON output. Example: \`subprocess.run(..., capture_output=True)\` or \`stdout=subprocess.DEVNULL\`.
- **Output files MUST be written to \`WORKSPACE_DIR\`** (available as env var: \`os.environ["WORKSPACE_DIR"]\` in Python, \`process.env.WORKSPACE_DIR\` in JS). NEVER write to \`/tmp\` — files outside workspace are invisible to the transfer system and cannot be sent to users. Use \`os.makedirs(workspace_dir, exist_ok=True)\` if needed.
- Output files must use **simple filenames without spaces** where possible (use underscores or hashes, sanitize any user/external input). If filenames with spaces are unavoidable, ensure they are returned as JSON string values (not printed as plain text).
- Return output file paths as **absolute paths** in the JSON output (e.g. \`os.path.join(workspace_dir, "output.mp3")\`). The system auto-detects workspace paths and transfers files from workers.

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

### Secrets in Skills

Vault secrets are automatically injected as environment variables into skill processes. The system scans SKILL.md for \`$VAR_NAME\` or \`\${VAR_NAME}\` references and injects matching vault secrets.

- Reference secrets in SKILL.md (e.g. in a "Secrets" section): \`$API_KEY\`, \`$SMTP_PASS\`
- Access in Python: \`os.environ.get("API_KEY")\`
- Access in JavaScript: \`process.env.API_KEY\`
- Access in Rust: \`std::env::var("API_KEY")\`
- Store via: \`vault_store({ name: "API_KEY", value: "..." })\`
- Skills should accept secrets both as input params AND env vars (env vars as fallback), so they work with or without vault.

### Rules

- IDs end with \`-skill\` (auto-appended). Default language: Python.
- Always test after creating. One skill per concern.
- Deps in metadata files only, never install from script code.
- On dependency errors: report and stop. On runtime errors: fix script, retry once. After 2-3 retries: tell user and stop.`;
