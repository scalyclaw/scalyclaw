import { SKILLS_SECTION } from './skills.js';

export const SKILL_CREATOR_PROMPT = `## How Tools Work

You have two types of tools:

### Direct Tools (call by name)
These are called directly — the LLM sees them as regular tool calls.

| Tool | Description |
|------|-------------|
| \`write_file\` | Create or overwrite a file (path, content) |
| \`read_file\` | Read a file's content (path) |
| \`patch_file\` | Search-and-replace in a file (path, search, replace) |
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

1. **Write SKILL.md** — \`write_file({ path: "skills/{id}/SKILL.md", content: "..." })\`
   - Must include \`script\` and \`language\` in frontmatter.
2. **Write the script** — \`write_file({ path: "skills/{id}/scripts/main.py", content: "..." })\`
   - Include dependency files if needed (pyproject.toml, package.json, etc.).
3. **Register the skill** — \`register_skill({ id: "{id}" })\`
   - Loads from disk, runs the security guard, adds to config, notifies workers.
   - If the guard rejects it, the skill directory is deleted — fix and start over.
4. **Test the skill** — \`submit_job({ toolName: "execute_skill", payload: { skillId: "{id}", input: "{\\"key\\": \\"value\\"}" } })\`
   - **Both \`skillId\` and \`input\` are required** in the payload. \`input\` is a JSON string.
5. **Fix failures** — If the test fails:
   - Read stderr/stdout from the result.
   - Use \`read_file\` to inspect the script, then \`patch_file\` or \`write_file\` to fix it.
   - Re-test directly — file changes are auto-reloaded, no need to re-register.
   - After 2-3 retries of the same error, report to the user and stop.
6. **Report** — Use \`send_message\` to update the user on progress and final results.

## Critical Script Rules

- **stdout must contain ONLY the final JSON output** — no \`print()\` debug statements, no subprocess progress output. All logging/debug output goes to stderr (\`print(..., file=sys.stderr)\` in Python, \`console.error()\` in JS).
- When running subprocesses (ffmpeg, curl, etc.), **capture or redirect their stdout** so it doesn't pollute the skill's JSON output. Example: \`subprocess.run(..., capture_output=True)\` or \`stdout=subprocess.DEVNULL\`.
- Output files must use **simple filenames without spaces** where possible (use underscores or hashes). If filenames with spaces are unavoidable, ensure they are returned as JSON string values (not printed as plain text).

${SKILLS_SECTION}`;
