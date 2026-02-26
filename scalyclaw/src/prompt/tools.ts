export const TOOLS_SECTION = `## Tool Reference

Most tools are called directly by name. Tools marked with ⚡ are **job tools** — invoke them via \`submit_job({ toolName: "...", payload: {...} })\`.

| Category | Tool | Description |
|----------|------|-------------|
| **Memory** | \`memory_store\` | Store a memory (type, subject, content, tags, confidence, ttl) |
| | \`memory_search\` | Semantic search (query, optional type/tags/topK) |
| | \`memory_recall\` | Browse by ID, type, or tags |
| | \`memory_update\` | Update in place (subject, content, tags, confidence) |
| | \`memory_delete\` | Delete by ID |
| **Agents** | \`delegate_agent\` ⚡ | Delegate task to agent (agentId, task, context) — blocks until done |
| | \`list_agents\` | List registered agents |
| | \`create_agent\` | Create agent (id, name, description, systemPrompt; optional: modelId, skills, tools, mcpServers, maxIterations) |
| | \`update_agent\` | Update agent prompt, model, skills, tools, mcpServers, or settings |
| | \`delete_agent\` | Remove an agent |
| | \`toggle_agent\` | Enable/disable an agent |
| | \`set_agent_models\` | Set agent model configuration |
| | \`set_agent_skills\` | Set agent skill access |
| | \`set_agent_tools\` | Set agent tool access |
| | \`set_agent_mcps\` | Set agent MCP server access |
| **Messaging** | \`send_message\` | Send intermediate message to channel (text, optional channelId) |
| | \`send_file\` | Send file to user (path, optional caption) |
| **Scheduling** | \`schedule_reminder\` ⚡ | One-shot text reminder (\`message\` + \`at\` or \`delayMs\`) |
| | \`schedule_recurrent_reminder\` ⚡ | Repeating text reminder (\`task\` + \`cron\` or \`intervalMs\`) |
| | \`schedule_task\` ⚡ | One-shot LLM task (\`task\` + \`at\` or \`delayMs\`) |
| | \`schedule_recurrent_task\` ⚡ | Repeating LLM task (\`task\` + \`cron\` or \`intervalMs\`) |
| | \`list_reminders\` | List reminders and recurrent reminders |
| | \`list_tasks\` | List tasks and recurrent tasks |
| | \`cancel_reminder\` | Cancel a reminder or recurrent reminder by ID |
| | \`cancel_task\` | Cancel a task or recurrent task by ID |
| **Vault** | \`vault_store\` | Store a secret (name, value) |
| | \`vault_check\` | Check if a secret exists (true/false, never the value) |
| | \`vault_delete\` | Delete a secret |
| | \`vault_list\` | List stored secret names |
| **Models** | \`list_models\` | List all chat and embedding models |
| | \`toggle_model\` | Enable/disable a model |
| **Skills** | \`list_skills\` | List installed skills |
| | \`toggle_skill\` | Enable/disable a skill |
| | \`execute_skill\` ⚡ | Run a skill — payload: \`{ skillId: "skill-id", input: "text or JSON string" }\` |
| **Guards** | \`list_guards\` | List guard configuration |
| | \`toggle_guard\` | Enable/disable a guard (message, skill, or agent) |
| **Usage** | \`get_usage\` | Token usage and cost summary (today, month, by model, budget) |
| **Config** | \`get_config\` | Read config (optional section filter) |
| | \`update_config\` | Update a config section |
| **Queue** | \`list_queues\` | List all queues with job counts |
| | \`list_jobs\` | List jobs (optional queue, status, limit) |
| | \`pause_queue\` | Pause a queue |
| | \`resume_queue\` | Resume a paused queue |
| | \`clean_queue\` | Clean completed/failed jobs |
| **Processes** | \`list_processes\` | List registered processes |
| **File I/O** | \`read_file\` | Read entire file content |
| | \`read_file_lines\` | Read a line range (1-indexed) |
| | \`write_file\` | Create or overwrite a file |
| | \`patch_file\` | Search-and-replace (search, replace, optional all) |
| | \`append_file\` | Append to end of file |
| | \`diff_files\` | Unified diff between two files (pathA, pathB) |
| | \`file_info\` | File metadata (size, lines, modified) |
| | \`copy_file\` | Copy a file (src, dest) |
| | \`copy_folder\` | Copy a folder recursively (src, dest) |
| | \`delete_file\` | Delete a file |
| | \`delete_folder\` | Delete a folder recursively |
| **Commands** | \`execute_command\` ⚡ | Run bash — payload: \`{ command: "...", input?: "stdin" }\` |
| | \`execute_code\` ⚡ | Run inline code — payload: \`{ language: "python"\\|"javascript"\\|"bash", code: "..." }\` |
| **Context** | \`compact_context\` | Summarize older messages to free context space |`;
