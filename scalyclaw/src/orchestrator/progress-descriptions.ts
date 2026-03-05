import { getAgent } from '../agents/agent-loader.js';
import { getSkill } from '@scalyclaw/shared/skills/skill-loader.js';

/** Extract a short detail string from tool input for a given key, truncated. */
export function detail(input: Record<string, unknown>, key: string, maxLen = 40): string {
  const val = input[key];
  if (val == null) return '';
  const s = String(val);
  return s.length > maxLen ? s.slice(0, maxLen) + '…' : s;
}

/** Resolve agent display name from agentId, falling back to the raw ID. */
function agentName(agentId: string): string {
  return getAgent(agentId)?.name ?? agentId;
}

/** Resolve skill display name from skillId, falling back to the raw ID. */
function skillName(skillId: string): string {
  return getSkill(skillId)?.name ?? skillId;
}

export function describeDirectTool(name: string, input: Record<string, unknown>): string {
  const d = (key: string, max?: number) => detail(input, key, max);
  switch (name) {
    // Memory
    case 'memory_store':    return `💾 Saving "${d('subject')}" to memory…`;
    case 'memory_search':   return `🔍 Searching memories for "${d('query')}"…`;
    case 'memory_recall':   return '🧠 Recalling memories…';
    case 'memory_update':   return `💾 Updating memory "${d('subject')}"…`;
    case 'memory_delete':   return '🗑️ Removing a memory…';
    case 'memory_reflect':  return '🔄 Reflecting on memories…';
    case 'memory_graph':    return `🕸️ Querying knowledge graph for "${d('entity')}"…`;
    // Messaging
    case 'send_message':    return `💬 Sending a message to ${d('channelId') || 'channel'}…`;
    case 'send_file':       return `📎 Sending ${d('filePath') || 'a file'}…`;
    // Agents
    case 'create_agent':    return `🤖 Creating agent "${d('name') || d('id')}"…`;
    case 'delete_agent':    return `🤖 Removing agent "${d('id')}"…`;
    // Skills
    case 'register_skill':  return `⚡ Registering skill "${d('id')}"…`;
    case 'execute_skill': {
      const sid = d('skillId') || d('id');
      return sid ? `⚡ Running skill "${skillName(sid)}"…` : '';
    }
    // Agents (direct call)
    case 'delegate_agent': {
      const aid = d('agentId');
      return aid ? `🤖 Delegating to "${agentName(aid)}"…` : '';
    }
    // Code & commands (direct call)
    case 'execute_code':    return `💻 Running ${d('language') || 'code'}…`;
    case 'execute_command': return `⚙️ Running command: ${d('command', 60) || '…'}`;
    // Vault
    case 'vault_store':     return `🔐 Storing secret "${d('name')}"…`;
    case 'vault_list':      return '🔐 Checking the vault…';
    // Scheduling
    case 'list_reminders':  return '⏰ Checking reminders…';
    case 'list_tasks':      return '📋 Checking tasks…';
    case 'cancel_reminder': return `⏰ Cancelling reminder ${d('jobId')}…`;
    case 'cancel_task':     return `📋 Cancelling task ${d('jobId')}…`;
    // Files
    case 'list_directory':  return `📂 Browsing ${d('path') || 'files'}…`;
    case 'file_read':       return `📄 Reading ${d('path') || 'a file'}…`;
    case 'file_write':      return `✏️ Writing ${d('path') || 'a file'}…`;
    case 'file_edit':       return `✏️ Editing ${d('path') || 'a file'}…`;
    case 'file_ops':        return `📁 ${d('operation') || 'Managing'} ${d('path') || 'files'}…`;
    // System
    case 'system_info':     return `📊 Checking ${d('section') || 'system info'}…`;
    case 'compact_context': return '🧹 Tidying up context…';
    // Jobs
    case 'get_job':          return `📋 Checking job ${d('jobId')}…`;
    case 'list_active_jobs': return '📋 Listing active jobs…';
    case 'stop_job':         return `🛑 Stopping job ${d('jobId')}…`;
    default:                 return '';
  }
}

export function describeSubmitJob(input: Record<string, unknown>): string {
  const toolName = input.toolName as string | undefined;
  const payload = (input.payload ?? {}) as Record<string, unknown>;
  const d = (key: string, max?: number) => detail(payload, key, max) || detail(input, key, max);
  switch (toolName) {
    case 'execute_command':              return `⚙️ Running command: ${d('command', 60) || '…'}`;
    case 'execute_skill': {
      const sid = d('skillId') || d('id');
      return sid ? `⚡ Running skill "${skillName(sid)}"…` : '';
    }
    case 'execute_code':                return `💻 Running ${d('language') || 'code'}…`;
    case 'delegate_agent': {
      const aid = d('agentId');
      return aid ? `🤖 Delegating to "${agentName(aid)}"…` : '';
    }
    case 'schedule_reminder':           return `⏰ Setting a reminder…`;
    case 'schedule_recurrent_reminder': return `⏰ Setting a recurring reminder…`;
    case 'schedule_task':               return `📋 Scheduling a task…`;
    case 'schedule_recurrent_task':     return `📋 Scheduling a recurring task…`;
    default:                            return '';
  }
}

export function describeToolCall(name: string, input: Record<string, unknown>): string {
  if (name === 'submit_job') return describeSubmitJob(input);
  if (name === 'submit_parallel_jobs') {
    const jobs = input.jobs as Array<Record<string, unknown>> | undefined;
    if (jobs?.length) {
      const lines = jobs.map(j => describeSubmitJob(j)).filter(Boolean);
      return [...new Set(lines)].join('\n');
    }
    return '⚡ Running parallel jobs…';
  }
  if (name.startsWith('mcp_')) return `🔌 Calling ${name.replace(/^mcp_/, '')}…`;
  return describeDirectTool(name, input);
}
