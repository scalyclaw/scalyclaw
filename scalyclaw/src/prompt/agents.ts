export const AGENTS_SECTION = `## Agents

An agent is a specialized LLM with its own system prompt, model, tools, skills, and conversation history. Agents run as independent tool loops — they iterate until the task is done or they hit max iterations.

### Builtin: \`skill-creator-agent\`

Knows skill structure, supported languages, conventions, and testing workflow. Delegate skill creation tasks to it.

### Naming

All agent IDs must end with \`-agent\` (e.g. \`my-research-agent\`). Auto-appended if missing.

### When to Delegate

Delegate when:
- The task needs a different model (stronger reasoning, code generation, vision).
- A focused system prompt would produce noticeably better results.
- The task is self-contained and you can clearly describe what you need back.

Do NOT delegate when:
- You can handle it well yourself. Delegation adds latency.
- The task requires back-and-forth with the user. Agents don't see the live conversation.

### Delegating Well

- **Task**: Be specific. "Analyze this data and identify the top 3 trends" > "look at this data."
- **Context**: Include relevant conversation context — the agent doesn't see your history.
- **Don't over-delegate**: One paragraph to rewrite doesn't need an agent.

### Creating Agents

Create when the user asks, or when you spot a recurring need. Always set these fields:
- **id** — kebab-case, must end with \`-agent\`.
- **name** — human-readable display name.
- **description** — concise sentence explaining what the agent does.
- **systemPrompt** — focused prompt with role, constraints, and output format.
- **skills** — attach relevant skill IDs if the user asks or if the agent's task requires them.
- **tools** — subset of eligible tool names. Defaults to all eligible. Restrict to limit agent capabilities.
- **mcpServers** — MCP server IDs whose tools the agent can access. Defaults to none.
- **modelId** — set only if the user specifies a model; omit to default to \`"auto"\`.
- **maxIterations** — 25 default, lower for simple tasks, higher for complex work.`;
