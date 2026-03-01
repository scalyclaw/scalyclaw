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

// ═══════════════════════════════════════════════════════════════════
// JOB-ONLY TOOLS — invoked through submit_job
// ═══════════════════════════════════════════════════════════════════

const JOB_ONLY_NAMES = [
  'execute_command', 'execute_skill', 'execute_code',
  'delegate_agent', 'schedule_reminder', 'schedule_recurrent_reminder',
  'schedule_task', 'schedule_recurrent_task',
] as const;

// ═══════════════════════════════════════════════════════════════════
// TOOL DEFINITIONS — LLM-visible tools only (28 tools)
// Admin/management tools removed from LLM but still callable via API.
// ═══════════════════════════════════════════════════════════════════

const TOOL_DEFS: ToolDefinition[] = [
  // ─── Memory (5) ───
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

  // ─── Messaging (2) ───
  tool('send_message', 'Send an intermediate message to a channel', schema({
    text: 'Message text',
    channelId: STR('Target channel (defaults to current)'),
  }, ['text'])),
  tool('send_file', 'Send a file to the user', schema({
    path: PATH,
    caption: STR('Optional caption'),
  }, ['path'])),

  // ─── Agents (1 — create only, admin ops via dashboard) ───
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

  // ─── Scheduling (4) ───
  tool('list_reminders', 'List reminders and recurrent reminders'),
  tool('list_tasks', 'List tasks and recurrent tasks'),
  tool('cancel_reminder', 'Cancel a reminder or recurrent reminder by ID', schema({ jobId: 'Reminder job ID to cancel' }, ['jobId'])),
  tool('cancel_task', 'Cancel a task or recurrent task by ID', schema({ jobId: 'Task job ID to cancel' }, ['jobId'])),

  // ─── Vault (2 — store + list only) ───
  tool('vault_store', 'Store a secret', schema({ name: 'Secret name', value: 'Secret value' }, ['name', 'value'])),
  tool('vault_list', 'List stored secret names'),

  // ─── Skills (1 — register only, admin ops via dashboard) ───
  tool('register_skill', 'Register a skill after writing its files. Loads from disk, runs security guard, adds to config, notifies workers.', schema({ id: STR('Skill ID (e.g. "weather-skill")') }, ['id'])),

  // ─── File I/O (5 merged tools) ───
  tool('list_directory', 'List contents of a directory', schema({
    path: STR('Home-relative directory path (e.g. "skills", "mind", "logs"). Defaults to home root.'),
    recursive: BOOL('List recursively (default false)'),
  })),
  tool('file_read', 'Read file content (full or line range)', schema({
    path: PATH,
    startLine: NUM('Start line (1-indexed, omit for full file)'),
    endLine: NUM('End line (inclusive, omit for rest of file)'),
  }, ['path'])),
  tool('file_write', 'Create, overwrite, or append to a file', schema({
    path: PATH,
    content: 'File content',
    append: BOOL('Append instead of overwrite (default false)'),
  }, ['path', 'content'])),
  tool('file_edit', 'Search-and-replace in a file', schema({
    path: PATH,
    search: 'String to find',
    replace: 'Replacement string',
    all: BOOL('Replace all occurrences (default false)'),
  }, ['path', 'search', 'replace'])),
  tool('file_ops', 'File operations: copy, delete, rename, diff, info', schema({
    action: ENUM('Operation to perform', ['copy_file', 'copy_folder', 'delete_file', 'delete_folder', 'rename_file', 'rename_folder', 'diff_files', 'file_info']),
    path: STR('Primary path (for delete, info)'),
    src: STR('Source path (for copy, rename, diff)'),
    dest: STR('Destination path (for copy, rename)'),
    pathA: STR('First file (for diff)'),
    pathB: STR('Second file (for diff)'),
  }, ['action'])),

  // ─── System Info (1 — read-only query, replaces all list_* admin tools) ───
  tool('system_info', 'Query system information', schema({
    section: ENUM('What to query', ['agents', 'skills', 'models', 'guards', 'queues', 'processes', 'usage', 'config', 'vault']),
  }, ['section'])),

  // ─── Context (1) ───
  tool('compact_context', 'Summarize older messages to free context space', schema({
    force: BOOL('Force compaction even if below threshold'),
  })),

  // ─── Job submission (2) ───
  tool('submit_job', [
    'Execute a job tool and wait for the result.',
    'Payload per tool:',
    '- execute_command: { command: string, input?: string }',
    '- execute_skill: { skillId: string, input?: string }',
    '- execute_code: { language: "python"|"javascript"|"bash", code: string }',
    '- delegate_agent: { agentId: string, task: string, context?: string }',
    '- schedule_reminder: { message: string, delayMs?: number, at?: string } — simple text delivery',
    '- schedule_recurrent_reminder: { task: string, cron?: string, intervalMs?: number } — repeating text',
    '- schedule_task: { task: string, delayMs?: number, at?: string } — one-shot LLM task',
    '- schedule_recurrent_task: { task: string, cron?: string, intervalMs?: number } — repeating LLM task',
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

  // ─── Job management (3) ───
  tool('get_job', 'Get the status and details of a job by its ID.', schema({ jobId: 'The job ID to look up' }, ['jobId'])),
  tool('list_active_jobs', 'List active and recent jobs across all queues.', schema({
    queue: STR('Optional queue key to filter'),
    status: ENUM('Optional status filter', ['waiting', 'active', 'completed', 'failed', 'delayed']),
    limit: NUM('Max jobs to return (default 20)'),
  })),
  tool('stop_job', 'Stop a running or pending job.', schema({ jobId: 'The job ID to stop' }, ['jobId'])),
];

// ═══════════════════════════════════════════════════════════════════
// AGENT TOOL SCOPING
// ═══════════════════════════════════════════════════════════════════

/** Tools available to agents as direct calls (operational only — no admin tools) */
const AGENT_DIRECT_NAMES = new Set([
  'send_message', 'send_file',
  'memory_store', 'memory_search', 'memory_recall', 'memory_update', 'memory_delete',
  'vault_store', 'vault_list',
  'list_directory', 'file_read', 'file_write', 'file_edit', 'file_ops',
  'register_skill',
]);

/** Job tools available to agents (no delegate_agent, no schedule_*) */
const AGENT_JOB_NAMES = ['execute_command', 'execute_skill', 'execute_code'] as const;

/** Union of all agent-eligible tool names (selectable universe for scoping) */
export const AGENT_ELIGIBLE_TOOL_NAMES: string[] = [...AGENT_DIRECT_NAMES, ...AGENT_JOB_NAMES];

// ═══════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════

/** Set of all tool names for dispatch (includes both LLM-visible and internal tools) */
export const TOOL_NAMES_SET = new Set([
  ...TOOL_DEFS.map(t => t.name),
  // Internal tools still registered for API/dashboard use
  'list_agents', 'update_agent', 'delete_agent', 'toggle_agent',
  'set_agent_models', 'set_agent_skills', 'set_agent_tools', 'set_agent_mcps',
  'list_models', 'toggle_model',
  'list_skills', 'toggle_skill', 'delete_skill',
  'list_guards', 'toggle_guard',
  'get_config', 'update_config',
  'vault_check', 'vault_delete',
  'get_usage',
  'list_processes', 'list_queues', 'list_jobs',
  'pause_queue', 'resume_queue', 'clean_queue',
  'delete_job',
  // Legacy file tool names (registered for backward compat with agents that reference them)
  'read_file', 'read_file_lines', 'write_file', 'patch_file', 'append_file',
  'diff_files', 'file_info', 'copy_file', 'copy_folder',
  'delete_file', 'delete_folder', 'rename_file', 'rename_folder',
]);

/** Orchestrator gets consolidated tool set */
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
    tool('stop_job', 'Stop a running or pending job.', schema({ jobId: 'The job ID to stop' }, ['jobId'])),
  );

  return result;
}
