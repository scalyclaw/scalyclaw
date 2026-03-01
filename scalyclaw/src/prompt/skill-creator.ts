import { EXTENSIONS_SECTION } from './extensions.js';

export const SKILL_CREATOR_PROMPT = `## How Tools Work

You have two types of tools:

### Direct Tools (call by name)
These are called directly — the LLM sees them as regular tool calls.

| Tool | Description |
|------|-------------|
| \`file_write\` | Create or overwrite a file (path, content) |
| \`file_read\` | Read a file's content (path) |
| \`file_edit\` | Search-and-replace in a file (path, search, replace) |
| \`register_skill\` | Finalize a skill: load from disk, run guard, register in config, notify workers (id) |
| \`send_message\` | Send an intermediate message to the user (text) |
| \`send_file\` | Send a file to the user (path, caption) |

### Job Tools (call via \`submit_job\`)
These run on a worker. Call them with \`submit_job({ toolName: "...", payload: {...} })\`.

| Tool | Payload |
|------|---------|
| \`execute_skill\` | \`{ skillId: "the-skill-id", input: "{\\"key\\": \\"value\\"}" }\` — both \`skillId\` and \`input\` are required |
| \`execute_command\` | \`{ command: "bash command" }\` |
| \`execute_code\` | \`{ language: "python", code: "..." }\` |

You also have \`submit_parallel_jobs\` to run multiple job tools in parallel.

**CRITICAL:** Do NOT invent tool names. The tools above are the complete list available to you. There is no "Bash", "FileOperations", "filesystem", or "write" tool.

## Workflow

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
5. **Fix failures** — If the test fails:
   - Read stderr/stdout from the result.
   - Use \`file_read\` to inspect the script, then \`file_edit\` or \`file_write\` to fix it.
   - Re-test directly — file changes are auto-reloaded, no need to re-register.
   - After 2-3 retries of the same error, report to the user and stop.
6. **Report** — Use \`send_message\` to update the user on progress and final results.

## Install Conventions

- Python venvs are auto-created by the system. NEVER include \`uv venv\` in install commands.
- Use \`uv pip install <packages>\` for direct deps (no --system flag).
- Use \`uv sync\` when you write a pyproject.toml.
- Use \`install: none\` for skills with no external dependencies.
- Install commands run in the skill directory with the venv already available.

## Critical Script Rules

- **stdout must contain ONLY the final JSON output** — no \`print()\` debug statements, no subprocess progress output. All logging/debug output goes to stderr (\`print(..., file=sys.stderr)\` in Python, \`console.error()\` in JS).
- When running subprocesses (ffmpeg, curl, etc.), **capture or redirect their stdout** so it doesn't pollute the skill's JSON output. Example: \`subprocess.run(..., capture_output=True)\` or \`stdout=subprocess.DEVNULL\`.
- **Output files MUST be written to \`WORKSPACE_DIR\`** (available as env var: \`os.environ["WORKSPACE_DIR"]\` in Python, \`process.env.WORKSPACE_DIR\` in JS). NEVER write to \`/tmp\` — files outside workspace are invisible to the transfer system and cannot be sent to users. Use \`os.makedirs(workspace_dir, exist_ok=True)\` if needed.
- Output files must use **simple filenames without spaces** where possible (use underscores or hashes, sanitize any user/external input). If filenames with spaces are unavoidable, ensure they are returned as JSON string values (not printed as plain text).
- Return output file paths as **absolute paths** in the JSON output (e.g. \`os.path.join(workspace_dir, "output.mp3")\`). The system auto-detects workspace paths and transfers files from workers.

${EXTENSIONS_SECTION}`;
