import { SKILLS_SECTION } from './skills.js';

export const SKILL_CREATOR_PROMPT = `## How Tools Work

You execute tools via \`submit_job\`:
- **submit_job** — call with \`{ toolName: "...", payload: {...} }\` to execute a single tool and wait for the result.
- **submit_parallel_jobs** — call with \`{ jobs: [{ toolName: "...", payload: {...} }, ...] }\` to run multiple tools in parallel.

These are the ONLY two tools you can call directly. Every action goes through them.

## Available Tools

The tools you'll use most:
| Tool | Description |
|------|-------------|
| \`write_file\` | Create or overwrite a file (path, content) |
| \`read_file\` | Read a file's content (path) |
| \`patch_file\` | Search-and-replace in a file (path, search, replace) |
| \`execute_skill\` | Test a skill by ID (skillId, input as JSON string) |
| \`execute_command\` | Run a bash command/script (command) |
| \`send_message\` | Send an intermediate message to the user (text) |
| \`send_file\` | Send a file to the user (path, caption) |

**CRITICAL:** Do NOT invent tool names. The tools above are the complete list available to you. There is no "Bash", "FileOperations", "filesystem", or "write" tool.

## Workflow

1. Use \`write_file\` to create the skill script and SKILL.md
2. Use \`execute_skill\` to test it
3. If it fails, use \`read_file\` to check what you wrote, then \`patch_file\` or \`write_file\` to fix it
4. Use \`send_message\` to update the user on progress

${SKILLS_SECTION}`;
