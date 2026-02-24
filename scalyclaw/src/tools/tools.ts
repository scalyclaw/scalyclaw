import type { ToolDefinition } from '../models/provider.js';

// ═══════════════════════════════════════════════════════════════════
// DIRECT TOOL DEFINITIONS — called by name, no wrapper
// ═══════════════════════════════════════════════════════════════════

const DIRECT_TOOL_DEFS: ToolDefinition[] = [
  // ─── Memory ───
  {
    name: 'memory_store',
    description: 'Store a memory (type, subject, content, tags, confidence, ttl)',
    input_schema: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'Memory type (e.g. fact, preference, event)' },
        subject: { type: 'string', description: 'Short subject/title' },
        content: { type: 'string', description: 'Full content of the memory' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Tags for categorization' },
        confidence: { type: 'number', description: 'Confidence score (0-3, default 2)' },
        source: { type: 'string', enum: ['user-stated', 'inferred'], description: 'Source of the memory' },
        ttl: { type: 'string', description: 'Time-to-live (e.g. "7d", "1h")' },
      },
      required: ['type', 'subject', 'content'],
    },
  },
  {
    name: 'memory_search',
    description: 'Semantic search over memories (query, optional type/tags/topK)',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        type: { type: 'string', description: 'Filter by memory type' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Filter by tags' },
        topK: { type: 'number', description: 'Max results (default 5)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'memory_recall',
    description: 'Browse memories by ID, type, or tags',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Recall a specific memory by ID' },
        type: { type: 'string', description: 'Filter by memory type' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Filter by tags' },
      },
    },
  },
  {
    name: 'memory_update',
    description: 'Update a memory in place (subject, content, tags, confidence)',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Memory ID to update' },
        subject: { type: 'string' },
        content: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        confidence: { type: 'number' },
      },
      required: ['id'],
    },
  },
  {
    name: 'memory_delete',
    description: 'Delete a memory by ID',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Memory ID to delete' },
      },
      required: ['id'],
    },
  },

  // ─── Messaging ───
  {
    name: 'send_message',
    description: 'Send an intermediate message to a channel',
    input_schema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Message text' },
        channelId: { type: 'string', description: 'Target channel (defaults to current)' },
      },
      required: ['text'],
    },
  },
  {
    name: 'send_file',
    description: 'Send a file to the user',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Workspace-relative file path' },
        caption: { type: 'string', description: 'Optional caption' },
      },
      required: ['path'],
    },
  },

  // ─── Agents (management) ───
  {
    name: 'list_agents',
    description: 'List registered agents',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'create_agent',
    description: 'Create a new agent (id, name, systemPrompt, modelId, skills, tools, mcpServers, maxIterations)',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Agent ID (will be suffixed with -agent if needed)' },
        name: { type: 'string', description: 'Display name' },
        description: { type: 'string', description: 'Short description' },
        systemPrompt: { type: 'string', description: 'System prompt for the agent' },
        modelId: { type: 'string', description: 'Model ID to use' },
        skills: { type: 'array', items: { type: 'string' }, description: 'Skill IDs the agent can use' },
        tools: { type: 'array', items: { type: 'string' }, description: 'Tool names the agent can use (defaults to all eligible)' },
        mcpServers: { type: 'array', items: { type: 'string' }, description: 'MCP server IDs the agent can access' },
        maxIterations: { type: 'number', description: 'Max tool-use iterations' },
      },
      required: ['id', 'name', 'systemPrompt'],
    },
  },
  {
    name: 'update_agent',
    description: 'Update agent prompt, model, skills, tools, mcpServers, or settings',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Agent ID' },
        name: { type: 'string' },
        description: { type: 'string' },
        systemPrompt: { type: 'string' },
        modelId: { type: 'string' },
        skills: { type: 'array', items: { type: 'string' } },
        tools: { type: 'array', items: { type: 'string' } },
        mcpServers: { type: 'array', items: { type: 'string' } },
        maxIterations: { type: 'number' },
      },
      required: ['id'],
    },
  },
  {
    name: 'delete_agent',
    description: 'Remove an agent',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Agent ID to delete' },
      },
      required: ['id'],
    },
  },
  {
    name: 'toggle_agent',
    description: 'Enable or disable an agent',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Agent ID' },
        enabled: { type: 'boolean', description: 'Enable (true) or disable (false)' },
      },
      required: ['id', 'enabled'],
    },
  },
  {
    name: 'set_agent_models',
    description: 'Set agent model configuration',
    input_schema: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'Agent ID' },
        models: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              model: { type: 'string' },
              weight: { type: 'number' },
              priority: { type: 'number' },
            },
            required: ['model'],
          },
        },
      },
      required: ['agentId', 'models'],
    },
  },
  {
    name: 'set_agent_skills',
    description: 'Set agent skill access',
    input_schema: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'Agent ID' },
        skills: { type: 'array', items: { type: 'string' }, description: 'Skill IDs' },
      },
      required: ['agentId', 'skills'],
    },
  },
  {
    name: 'set_agent_tools',
    description: 'Set agent tool access',
    input_schema: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'Agent ID' },
        tools: { type: 'array', items: { type: 'string' }, description: 'Tool names from eligible set' },
      },
      required: ['agentId', 'tools'],
    },
  },
  {
    name: 'set_agent_mcps',
    description: 'Set agent MCP server access',
    input_schema: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'Agent ID' },
        mcpServers: { type: 'array', items: { type: 'string' }, description: 'MCP server IDs' },
      },
      required: ['agentId', 'mcpServers'],
    },
  },

  // ─── Scheduling (direct management only) ───
  {
    name: 'list_reminders',
    description: 'List reminders and recurrent reminders',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'list_tasks',
    description: 'List tasks and recurrent tasks',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'cancel_reminder',
    description: 'Cancel a reminder or recurrent reminder by ID',
    input_schema: {
      type: 'object',
      properties: {
        jobId: { type: 'string', description: 'Reminder job ID to cancel' },
      },
      required: ['jobId'],
    },
  },
  {
    name: 'cancel_task',
    description: 'Cancel a task or recurrent task by ID',
    input_schema: {
      type: 'object',
      properties: {
        jobId: { type: 'string', description: 'Task job ID to cancel' },
      },
      required: ['jobId'],
    },
  },

  // ─── Vault ───
  {
    name: 'vault_store',
    description: 'Store a secret (name, value)',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Secret name' },
        value: { type: 'string', description: 'Secret value' },
      },
      required: ['name', 'value'],
    },
  },
  {
    name: 'vault_check',
    description: 'Check if a secret exists (returns true/false, never the value)',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Secret name to check' },
      },
      required: ['name'],
    },
  },
  {
    name: 'vault_delete',
    description: 'Delete a secret',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Secret name to delete' },
      },
      required: ['name'],
    },
  },
  {
    name: 'vault_list',
    description: 'List stored secret names',
    input_schema: { type: 'object', properties: {} },
  },

  // ─── Models ───
  {
    name: 'list_models',
    description: 'List all chat and embedding models',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'toggle_model',
    description: 'Enable or disable a model',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Model ID' },
        enabled: { type: 'boolean', description: 'Enable (true) or disable (false)' },
      },
      required: ['id', 'enabled'],
    },
  },

  // ─── Skills ───
  {
    name: 'list_skills',
    description: 'List installed skills',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'toggle_skill',
    description: 'Enable or disable a skill',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Skill ID' },
        enabled: { type: 'boolean', description: 'Enable (true) or disable (false)' },
      },
      required: ['id', 'enabled'],
    },
  },

  // ─── Guards ───
  {
    name: 'list_guards',
    description: 'List guard configuration',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'toggle_guard',
    description: 'Enable or disable a guard (message, skill, or agent)',
    input_schema: {
      type: 'object',
      properties: {
        guard: { type: 'string', enum: ['message', 'skill', 'agent'], description: 'Guard type' },
        enabled: { type: 'boolean', description: 'Enable (true) or disable (false)' },
      },
      required: ['guard', 'enabled'],
    },
  },

  // ─── Config ───
  {
    name: 'get_config',
    description: 'Read config (optional section filter)',
    input_schema: {
      type: 'object',
      properties: {
        section: { type: 'string', description: 'Config section to read (omit for full config)' },
      },
    },
  },
  {
    name: 'update_config',
    description: 'Update a config section',
    input_schema: {
      type: 'object',
      properties: {
        section: { type: 'string', description: 'Config section to update' },
        values: { type: 'object', description: 'Key-value pairs to merge into the section' },
      },
      required: ['section', 'values'],
    },
  },

  // ─── Usage ───
  {
    name: 'get_usage',
    description: 'Get token usage and cost summary (today, this month, by model, budget status)',
    input_schema: { type: 'object', properties: {} },
  },

  // ─── Queue/Process Management ───
  {
    name: 'list_processes',
    description: 'List registered processes',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'list_queues',
    description: 'List all queues with job counts',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'list_jobs',
    description: 'List jobs (optional queue, status, limit)',
    input_schema: {
      type: 'object',
      properties: {
        queue: { type: 'string', description: 'Queue key to filter' },
        status: { type: 'string', enum: ['waiting', 'active', 'completed', 'failed', 'delayed'], description: 'Status filter' },
        limit: { type: 'number', description: 'Max jobs to return (default 20)' },
      },
    },
  },
  {
    name: 'pause_queue',
    description: 'Pause a queue',
    input_schema: {
      type: 'object',
      properties: {
        queue: { type: 'string', description: 'Queue key to pause' },
      },
      required: ['queue'],
    },
  },
  {
    name: 'resume_queue',
    description: 'Resume a paused queue',
    input_schema: {
      type: 'object',
      properties: {
        queue: { type: 'string', description: 'Queue key to resume' },
      },
      required: ['queue'],
    },
  },
  {
    name: 'clean_queue',
    description: 'Clean completed or failed jobs from a queue',
    input_schema: {
      type: 'object',
      properties: {
        queue: { type: 'string', description: 'Queue key to clean' },
        status: { type: 'string', enum: ['completed', 'failed'], description: 'Job status to clean' },
        age: { type: 'number', description: 'Max age in ms (default 24h)' },
      },
      required: ['queue', 'status'],
    },
  },

  // ─── File I/O ───
  {
    name: 'read_file',
    description: 'Read entire file content',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Workspace-relative file path' },
      },
      required: ['path'],
    },
  },
  {
    name: 'read_file_lines',
    description: 'Read a line range (1-indexed)',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Workspace-relative file path' },
        startLine: { type: 'number', description: 'Start line (1-indexed)' },
        endLine: { type: 'number', description: 'End line (inclusive, omit for rest of file)' },
      },
      required: ['path', 'startLine'],
    },
  },
  {
    name: 'write_file',
    description: 'Create or overwrite a file',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Workspace-relative file path' },
        content: { type: 'string', description: 'File content' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'patch_file',
    description: 'Search-and-replace in a file (search, replace, optional all)',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Workspace-relative file path' },
        search: { type: 'string', description: 'String to find' },
        replace: { type: 'string', description: 'Replacement string' },
        all: { type: 'boolean', description: 'Replace all occurrences (default false)' },
      },
      required: ['path', 'search', 'replace'],
    },
  },
  {
    name: 'append_file',
    description: 'Append content to end of file',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Workspace-relative file path' },
        content: { type: 'string', description: 'Content to append' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'diff_files',
    description: 'Unified diff between two files',
    input_schema: {
      type: 'object',
      properties: {
        pathA: { type: 'string', description: 'First file path' },
        pathB: { type: 'string', description: 'Second file path' },
      },
      required: ['pathA', 'pathB'],
    },
  },
  {
    name: 'file_info',
    description: 'File metadata (size, lines, modified)',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Workspace-relative file path' },
      },
      required: ['path'],
    },
  },
  {
    name: 'copy_file',
    description: 'Copy a file',
    input_schema: {
      type: 'object',
      properties: {
        src: { type: 'string', description: 'Source file path' },
        dest: { type: 'string', description: 'Destination file path' },
      },
      required: ['src', 'dest'],
    },
  },
  {
    name: 'copy_folder',
    description: 'Copy a folder recursively',
    input_schema: {
      type: 'object',
      properties: {
        src: { type: 'string', description: 'Source folder path' },
        dest: { type: 'string', description: 'Destination folder path' },
      },
      required: ['src', 'dest'],
    },
  },

  // ─── Context ───
  {
    name: 'compact_context',
    description: 'Summarize older messages to free context space',
    input_schema: {
      type: 'object',
      properties: {
        force: { type: 'boolean', description: 'Force compaction even if below threshold' },
      },
    },
  },
];

// ═══════════════════════════════════════════════════════════════════
// JOB-ONLY TOOLS — invoked through submit_job
// ═══════════════════════════════════════════════════════════════════

const JOB_ONLY_NAMES = [
  'execute_command', 'execute_skill', 'execute_code',
  'delegate_agent', 'schedule_reminder', 'schedule_recurrent_reminder',
  'schedule_task', 'schedule_recurrent_task',
] as const;

// ═══════════════════════════════════════════════════════════════════
// AGENT TOOL SCOPING
// ═══════════════════════════════════════════════════════════════════

/** Direct tools available to agents (operational only — no admin tools) */
const AGENT_DIRECT_NAMES = new Set([
  'send_message', 'send_file',
  'memory_store', 'memory_search', 'memory_recall', 'memory_update', 'memory_delete',
  'vault_check', 'vault_list',
  'read_file', 'read_file_lines', 'write_file', 'patch_file', 'append_file',
  'diff_files', 'file_info', 'copy_file', 'copy_folder',
]);

/** Job tools available to agents (no delegate_agent, no schedule_*) */
const AGENT_JOB_NAMES = ['execute_command', 'execute_skill', 'execute_code'] as const;

/** Union of all agent-eligible tool names (selectable universe for scoping) */
export const AGENT_ELIGIBLE_TOOL_NAMES: string[] = [...AGENT_DIRECT_NAMES, ...AGENT_JOB_NAMES];

// ═══════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════

/** Set of direct tool names for dispatch in tool-impl.ts */
export const DIRECT_TOOL_NAMES_SET = new Set(DIRECT_TOOL_DEFS.map(t => t.name));

// ─── Build tool definitions from context ───

function buildToolDefs(): ToolDefinition[] {
  return [
    ...DIRECT_TOOL_DEFS,
    // ─── Meta: Job submission ───
    {
      name: 'submit_job',
      description: [
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
      ].join('\n'),
      input_schema: {
        type: 'object',
        properties: {
          toolName: { type: 'string', enum: [...JOB_ONLY_NAMES], description: 'Job tool to execute' },
          payload: { type: 'object', description: 'Tool-specific parameters (see description above)' },
        },
        required: ['toolName', 'payload'],
      },
    },
    {
      name: 'submit_parallel_jobs',
      description: 'Execute multiple tools in parallel and wait for all results.',
      input_schema: {
        type: 'object',
        properties: {
          jobs: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                toolName: { type: 'string', description: 'Any tool name' },
                payload: { type: 'object' },
              },
              required: ['toolName'],
            },
          },
        },
        required: ['jobs'],
      },
    },
    // ─── Meta: Job management ───
    {
      name: 'get_job',
      description: 'Get the status and details of a job by its ID.',
      input_schema: {
        type: 'object',
        properties: {
          jobId: { type: 'string', description: 'The job ID to look up' },
        },
        required: ['jobId'],
      },
    },
    {
      name: 'list_active_jobs',
      description: 'List active and recent jobs across all queues.',
      input_schema: {
        type: 'object',
        properties: {
          queue: { type: 'string', description: 'Optional queue key to filter' },
          status: { type: 'string', enum: ['waiting', 'active', 'completed', 'failed', 'delayed'], description: 'Optional status filter' },
          limit: { type: 'number', description: 'Max jobs to return (default 20)' },
        },
      },
    },
  ];
}

/** Build scoped tool definitions for an agent based on allowed tools, skills, and MCPs */
export function buildAgentToolDefs(allowedTools: string[], allowedSkillIds: string[], mcpTools: ToolDefinition[]): ToolDefinition[] {
  const allowedSet = new Set(allowedTools);

  // Filter direct tools to intersection with allowed
  const directTools = DIRECT_TOOL_DEFS.filter(t => AGENT_DIRECT_NAMES.has(t.name) && allowedSet.has(t.name));

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

    result.push({
      name: 'submit_job',
      description: jobDescLines.join('\n'),
      input_schema: {
        type: 'object',
        properties: {
          toolName: { type: 'string', enum: allowedJobNames },
          payload: { type: 'object', description: 'Input parameters for the tool (see description for schema per tool)' },
        },
        required: ['toolName', 'payload'],
      },
    });
    result.push({
      name: 'submit_parallel_jobs',
      description: 'Execute multiple tools in parallel and wait for all results.',
      input_schema: {
        type: 'object',
        properties: {
          jobs: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                toolName: { type: 'string', enum: allowedJobNames },
                payload: { type: 'object' },
              },
              required: ['toolName'],
            },
          },
        },
        required: ['jobs'],
      },
    });
  }

  // Append MCP tools
  result.push(...mcpTools);

  // Always include meta tools for job management
  result.push(
    {
      name: 'get_job',
      description: 'Get the status and details of a job by its ID.',
      input_schema: {
        type: 'object',
        properties: {
          jobId: { type: 'string', description: 'The job ID to look up' },
        },
        required: ['jobId'],
      },
    },
    {
      name: 'list_active_jobs',
      description: 'List active and recent jobs across all queues.',
      input_schema: {
        type: 'object',
        properties: {
          queue: { type: 'string', description: 'Optional queue key to filter' },
          status: { type: 'string', enum: ['waiting', 'active', 'completed', 'failed', 'delayed'], description: 'Optional status filter' },
          limit: { type: 'number', description: 'Max jobs to return (default 20)' },
        },
      },
    },
  );

  return result;
}

// ─── LLM-Facing Tools ───

/** Orchestrator gets all tools */
export const ASSISTANT_TOOLS: ToolDefinition[] = buildToolDefs();
