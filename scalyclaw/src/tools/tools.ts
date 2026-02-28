import type { ToolDefinition } from '../models/provider.js';

// ═══════════════════════════════════════════════════════════════════
// SCHEMA BUILDER HELPERS
// ═══════════════════════════════════════════════════════════════════

type Prop = { type: string; description?: string; enum?: string[]; items?: unknown; properties?: Record<string, unknown>; required?: string[] };

function schema(props: Record<string, Prop | string>, required?: string[]) {
  const properties: Record<string, Prop> = {};
  for (const [k, v] of Object.entries(props))
    properties[k] = typeof v === 'string' ? { type: 'string', description: v } : v;
  return { type: 'object' as const, properties, ...(required && { required }) };
}

function tool(name: string, description: string, input?: ReturnType<typeof schema>): ToolDefinition {
  return { name, description, input_schema: input ?? { type: 'object', properties: {} } };
}

const STR = (d: string): Prop => ({ type: 'string', description: d });
const BOOL = (d: string): Prop => ({ type: 'boolean', description: d });
const NUM = (d: string): Prop => ({ type: 'number', description: d });
const STRARR = (d: string): Prop => ({ type: 'array', items: { type: 'string' }, description: d });
const ENUM = (d: string, values: string[]): Prop => ({ type: 'string', description: d, enum: values });
const PATH = 'Home-relative path';
const TOGGLE = BOOL('Enable (true) or disable (false)');

// ═══════════════════════════════════════════════════════════════════
// JOB-ONLY TOOLS — invoked through submit_job
// ═══════════════════════════════════════════════════════════════════

const JOB_ONLY_NAMES = [
  'execute_command', 'execute_skill', 'execute_code',
  'delegate_agent', 'schedule_reminder', 'schedule_recurrent_reminder',
  'schedule_task', 'schedule_recurrent_task',
] as const;

// ═══════════════════════════════════════════════════════════════════
// TOOL DEFINITIONS — all tools in one flat list
// ═══════════════════════════════════════════════════════════════════

const TOOL_DEFS: ToolDefinition[] = [
  // ─── Memory ───
  tool('memory_store', 'Store a memory', schema({
    type: STR('Memory type (e.g. fact, preference, event)'),
    subject: 'Short subject/title',
    content: 'Full content of the memory',
    tags: STRARR('Tags for categorization'),
    confidence: NUM('Confidence score (0-3, default 2)'),
    source: ENUM('Source of the memory', ['user-stated', 'inferred']),
    ttl: STR('Time-to-live (e.g. "7d", "1h")'),
  }, ['type', 'subject', 'content'])),
  tool('memory_search', 'Semantic search over memories', schema({
    query: 'Search query',
    type: STR('Filter by memory type'),
    tags: STRARR('Filter by tags'),
    topK: NUM('Max results (default 5)'),
  }, ['query'])),
  tool('memory_recall', 'Browse memories by ID, type, or tags', schema({
    id: 'Recall a specific memory by ID',
    type: STR('Filter by memory type'),
    tags: STRARR('Filter by tags'),
  })),
  tool('memory_update', 'Update a memory in place', schema({
    id: 'Memory ID to update',
    subject: STR(''),
    content: STR(''),
    tags: STRARR(''),
    confidence: NUM(''),
  }, ['id'])),
  tool('memory_delete', 'Delete a memory by ID', schema({ id: 'Memory ID to delete' }, ['id'])),

  // ─── Messaging ───
  tool('send_message', 'Send an intermediate message to a channel', schema({
    text: 'Message text',
    channelId: STR('Target channel (defaults to current)'),
  }, ['text'])),
  tool('send_file', 'Send a file to the user', schema({
    path: PATH,
    caption: STR('Optional caption'),
  }, ['path'])),

  // ─── Agents (management) ───
  tool('list_agents', 'List registered agents'),
  tool('create_agent', 'Create a new agent', schema({
    id: STR('Agent ID (will be suffixed with -agent if needed)'),
    name: 'Display name',
    description: 'Short description',
    systemPrompt: 'System prompt for the agent',
    modelId: STR('Model ID to use'),
    skills: STRARR('Skill IDs the agent can use'),
    tools: STRARR('Tool names the agent can use (defaults to all eligible)'),
    mcpServers: STRARR('MCP server IDs the agent can access'),
    maxIterations: NUM('Max tool-use iterations'),
  }, ['id', 'name', 'systemPrompt'])),
  tool('update_agent', 'Update agent prompt, model, skills, tools, mcpServers, or settings', schema({
    id: 'Agent ID',
    name: STR(''), description: STR(''), systemPrompt: STR(''), modelId: STR(''),
    skills: STRARR(''), tools: STRARR(''), mcpServers: STRARR(''),
    maxIterations: NUM(''),
  }, ['id'])),
  tool('delete_agent', 'Remove an agent', schema({ id: 'Agent ID to delete' }, ['id'])),
  tool('toggle_agent', 'Enable or disable an agent', schema({
    id: 'Agent ID', enabled: TOGGLE,
  }, ['id', 'enabled'])),
  tool('set_agent_models', 'Set agent model configuration', schema({
    agentId: 'Agent ID',
    models: {
      type: 'array',
      items: {
        type: 'object',
        properties: { model: { type: 'string' }, weight: { type: 'number' }, priority: { type: 'number' } },
        required: ['model'],
      },
    },
  }, ['agentId', 'models'])),
  tool('set_agent_skills', 'Set agent skill access', schema({
    agentId: 'Agent ID', skills: STRARR('Skill IDs'),
  }, ['agentId', 'skills'])),
  tool('set_agent_tools', 'Set agent tool access', schema({
    agentId: 'Agent ID', tools: STRARR('Tool names from eligible set'),
  }, ['agentId', 'tools'])),
  tool('set_agent_mcps', 'Set agent MCP server access', schema({
    agentId: 'Agent ID', mcpServers: STRARR('MCP server IDs'),
  }, ['agentId', 'mcpServers'])),

  // ─── Scheduling (direct management only) ───
  tool('list_reminders', 'List reminders and recurrent reminders'),
  tool('list_tasks', 'List tasks and recurrent tasks'),
  tool('cancel_reminder', 'Cancel a reminder or recurrent reminder by ID', schema({ jobId: 'Reminder job ID to cancel' }, ['jobId'])),
  tool('cancel_task', 'Cancel a task or recurrent task by ID', schema({ jobId: 'Task job ID to cancel' }, ['jobId'])),

  // ─── Vault ───
  tool('vault_store', 'Store a secret', schema({ name: 'Secret name', value: 'Secret value' }, ['name', 'value'])),
  tool('vault_check', 'Check if a secret exists (returns true/false, never the value)', schema({ name: 'Secret name to check' }, ['name'])),
  tool('vault_delete', 'Delete a secret', schema({ name: 'Secret name to delete' }, ['name'])),
  tool('vault_list', 'List stored secret names'),

  // ─── Models ───
  tool('list_models', 'List all chat and embedding models'),
  tool('toggle_model', 'Enable or disable a model', schema({ id: 'Model ID', enabled: TOGGLE }, ['id', 'enabled'])),

  // ─── Skills ───
  tool('list_skills', 'List installed skills'),
  tool('toggle_skill', 'Enable or disable a skill', schema({ id: 'Skill ID', enabled: TOGGLE }, ['id', 'enabled'])),
  tool('delete_skill', 'Delete a skill by ID', schema({ id: 'Skill ID to delete' }, ['id'])),
  tool('register_skill', 'Register a skill after writing its files. Loads from disk, runs security guard, adds to config, notifies workers.', schema({ id: STR('Skill ID (e.g. "weather-skill")') }, ['id'])),

  // ─── Guards ───
  tool('list_guards', 'List guard configuration'),
  tool('toggle_guard', 'Enable or disable a guard', schema({
    guard: ENUM('Guard type', ['message', 'skill', 'agent', 'commandShield']),
    enabled: TOGGLE,
  }, ['guard', 'enabled'])),

  // ─── Config ───
  tool('get_config', 'Read config (optional section filter)', schema({
    section: STR('Config section to read (omit for full config)'),
  })),
  tool('update_config', 'Update a config section', schema({
    section: 'Config section to update',
    values: { type: 'object', description: 'Key-value pairs to merge into the section' },
  }, ['section', 'values'])),

  // ─── Usage ───
  tool('get_usage', 'Get token usage and cost summary (today, this month, by model, budget status)'),

  // ─── Queue/Process Management ───
  tool('list_processes', 'List registered processes'),
  tool('list_queues', 'List all queues with job counts'),
  tool('list_jobs', 'List jobs', schema({
    queue: STR('Queue key to filter'),
    status: ENUM('Status filter', ['waiting', 'active', 'completed', 'failed', 'delayed']),
    limit: NUM('Max jobs to return (default 20)'),
  })),
  tool('pause_queue', 'Pause a queue', schema({ queue: 'Queue key to pause' }, ['queue'])),
  tool('resume_queue', 'Resume a paused queue', schema({ queue: 'Queue key to resume' }, ['queue'])),
  tool('clean_queue', 'Clean completed or failed jobs from a queue', schema({
    queue: 'Queue key to clean',
    status: ENUM('Job status to clean', ['completed', 'failed']),
    age: NUM('Max age in ms (default 24h)'),
  }, ['queue', 'status'])),

  // ─── File I/O ───
  tool('list_directory', 'List contents of a directory', schema({
    path: STR('Home-relative directory path (e.g. "skills", "mind", "logs"). Defaults to home root.'),
    recursive: BOOL('List recursively (default false)'),
  })),
  tool('read_file', 'Read entire file content', schema({ path: PATH }, ['path'])),
  tool('read_file_lines', 'Read a line range (1-indexed)', schema({
    path: PATH, startLine: NUM('Start line (1-indexed)'), endLine: NUM('End line (inclusive, omit for rest of file)'),
  }, ['path', 'startLine'])),
  tool('write_file', 'Create or overwrite a file', schema({ path: PATH, content: 'File content' }, ['path', 'content'])),
  tool('patch_file', 'Search-and-replace in a file', schema({
    path: PATH, search: 'String to find', replace: 'Replacement string', all: BOOL('Replace all occurrences (default false)'),
  }, ['path', 'search', 'replace'])),
  tool('append_file', 'Append content to end of file', schema({ path: PATH, content: 'Content to append' }, ['path', 'content'])),
  tool('diff_files', 'Unified diff between two files', schema({ pathA: 'First file path', pathB: 'Second file path' }, ['pathA', 'pathB'])),
  tool('file_info', 'File metadata (size, lines, modified)', schema({ path: PATH }, ['path'])),
  tool('copy_file', 'Copy a file', schema({ src: 'Source file path', dest: 'Destination file path' }, ['src', 'dest'])),
  tool('copy_folder', 'Copy a folder recursively', schema({ src: 'Source folder path', dest: 'Destination folder path' }, ['src', 'dest'])),
  tool('delete_file', 'Delete a file', schema({ path: 'File path to delete' }, ['path'])),
  tool('delete_folder', 'Delete a folder recursively', schema({ path: 'Folder path to delete' }, ['path'])),
  tool('rename_file', 'Rename or move a file', schema({ src: 'Current file path', dest: 'New file path' }, ['src', 'dest'])),
  tool('rename_folder', 'Rename or move a folder', schema({ src: 'Current folder path', dest: 'New folder path' }, ['src', 'dest'])),

  // ─── Context ───
  tool('compact_context', 'Summarize older messages to free context space', schema({
    force: BOOL('Force compaction even if below threshold'),
  })),

  // ─── Job submission ───
  tool('submit_job', [
    'Execute a job tool and wait for the result.',
    'Payload per tool:',
    '- execute_command: { command: string, input?: string }',
    '- execute_skill: { skillId: string, input?: string }',
    '- execute_code: { language: "python"|"javascript"|"bash", code: string }',
    '- delegate_agent: { agentId: string, task: string, context?: string }',
    '- schedule_reminder: { message: string, delayMs?: number, at?: string } — simple text delivery. e.g. { message: "Stand up", delayMs: 1800000 }',
    '- schedule_recurrent_reminder: { task: string, cron?: string, intervalMs?: number } — repeating text delivery. e.g. { task: "Drink water", cron: "0 * * * *" }',
    '- schedule_task: { task: string, delayMs?: number, at?: string } — one-shot LLM task. e.g. { task: "Check weather and summarize", at: "2026-02-24T09:00:00Z" }',
    '- schedule_recurrent_task: { task: string, cron?: string, intervalMs?: number } — repeating LLM task. e.g. { task: "Summarize inbox", cron: "0 9 * * *" }',
  ].join('\n'), schema({
    toolName: ENUM('Job tool to execute', [...JOB_ONLY_NAMES]),
    payload: { type: 'object', description: 'Tool-specific parameters (see description above)' },
  }, ['toolName', 'payload'])),
  tool('submit_parallel_jobs', 'Execute multiple tools in parallel and wait for all results.', schema({
    jobs: {
      type: 'array',
      items: {
        type: 'object',
        properties: { toolName: { type: 'string', description: 'Any tool name' }, payload: { type: 'object' } },
        required: ['toolName'],
      },
    },
  }, ['jobs'])),

  // ─── Job management ───
  tool('get_job', 'Get the status and details of a job by its ID.', schema({ jobId: 'The job ID to look up' }, ['jobId'])),
  tool('list_active_jobs', 'List active and recent jobs across all queues.', schema({
    queue: STR('Optional queue key to filter'),
    status: ENUM('Optional status filter', ['waiting', 'active', 'completed', 'failed', 'delayed']),
    limit: NUM('Max jobs to return (default 20)'),
  })),
  tool('stop_job', 'Stop a running or pending job. Use when a job is stuck, no longer needed, or needs to be retried differently.', schema({ jobId: 'The job ID to stop' }, ['jobId'])),
  tool('delete_job', 'Delete a job permanently. Works for scheduled jobs (tasks/reminders) and queue jobs.', schema({ jobId: 'The job ID to delete' }, ['jobId'])),
];

// ═══════════════════════════════════════════════════════════════════
// AGENT TOOL SCOPING
// ═══════════════════════════════════════════════════════════════════

/** Tools available to agents as direct calls (operational only — no admin tools) */
const AGENT_DIRECT_NAMES = new Set([
  'send_message', 'send_file',
  'memory_store', 'memory_search', 'memory_recall', 'memory_update', 'memory_delete',
  'vault_check', 'vault_list',
  'list_directory', 'read_file', 'read_file_lines', 'write_file', 'patch_file', 'append_file',
  'diff_files', 'file_info', 'copy_file', 'copy_folder',
  'delete_file', 'delete_folder', 'rename_file', 'rename_folder',
  'register_skill',
]);

/** Job tools available to agents (no delegate_agent, no schedule_*) */
const AGENT_JOB_NAMES = ['execute_command', 'execute_skill', 'execute_code'] as const;

/** Union of all agent-eligible tool names (selectable universe for scoping) */
export const AGENT_ELIGIBLE_TOOL_NAMES: string[] = [...AGENT_DIRECT_NAMES, ...AGENT_JOB_NAMES];

// ═══════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════

/** Set of all tool names for dispatch */
export const TOOL_NAMES_SET = new Set(TOOL_DEFS.map(t => t.name));

/** Orchestrator gets all tools */
export const ASSISTANT_TOOLS: ToolDefinition[] = TOOL_DEFS;

/** Build scoped tool definitions for an agent based on allowed tools, skills, and MCPs */
export function buildAgentToolDefs(allowedTools: string[], allowedSkillIds: string[], mcpTools: ToolDefinition[]): ToolDefinition[] {
  const allowedSet = new Set(allowedTools);

  // Filter direct tools to intersection with allowed
  const directTools = TOOL_DEFS.filter(t => AGENT_DIRECT_NAMES.has(t.name) && allowedSet.has(t.name));

  // Filter job tools to intersection with allowed
  const allowedJobNames = AGENT_JOB_NAMES.filter(n => allowedSet.has(n));

  const skillNote = allowedSkillIds.length > 0
    ? ` (allowed: ${allowedSkillIds.join(', ')})`
    : '';

  const result: ToolDefinition[] = [...directTools];

  // Only include submit_job / submit_parallel_jobs if there are allowed job tools
  if (allowedJobNames.length > 0) {
    const jobDescLines = ['Execute a job tool and wait for the result.', 'Payload per tool:'];
    if (allowedJobNames.includes('execute_command')) jobDescLines.push('- execute_command: { command: string, input?: string }');
    if (allowedJobNames.includes('execute_skill')) jobDescLines.push(`- execute_skill: { skillId: string, input?: string }${skillNote}`);
    if (allowedJobNames.includes('execute_code')) jobDescLines.push('- execute_code: { language: "python"|"javascript"|"bash", code: string }');

    result.push(
      tool('submit_job', jobDescLines.join('\n'), schema({
        toolName: ENUM('', allowedJobNames as unknown as string[]),
        payload: { type: 'object', description: 'Input parameters for the tool (see description for schema per tool)' },
      }, ['toolName', 'payload'])),
      tool('submit_parallel_jobs', 'Execute multiple tools in parallel and wait for all results.', schema({
        jobs: {
          type: 'array',
          items: {
            type: 'object',
            properties: { toolName: { type: 'string', enum: allowedJobNames as unknown as string[] }, payload: { type: 'object' } },
            required: ['toolName'],
          },
        },
      }, ['jobs'])),
    );
  }

  // Append MCP tools
  result.push(...mcpTools);

  // Job management — always included
  result.push(
    tool('get_job', 'Get the status and details of a job by its ID.', schema({ jobId: 'The job ID to look up' }, ['jobId'])),
    tool('list_active_jobs', 'List active and recent jobs across all queues.', schema({
      queue: STR('Optional queue key to filter'),
      status: ENUM('Optional status filter', ['waiting', 'active', 'completed', 'failed', 'delayed']),
      limit: NUM('Max jobs to return (default 20)'),
    })),
    tool('stop_job', 'Stop a running or pending job. Use when a job is stuck, no longer needed, or needs to be retried differently.', schema({ jobId: 'The job ID to stop' }, ['jobId'])),
  );

  return result;
}
