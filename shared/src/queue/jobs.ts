import type { QueueName } from './queue.js';

// ─── Job Data Types ───

export interface AgentTaskData {
  channelId: string;
  task: string;
  agentId: string | null;
  context: string;
}

export interface ReminderData {
  channelId: string;
  message: string;
  originalContext: string;
  scheduledJobId: string;
}

export interface RecurrentReminderData {
  channelId: string;
  task: string;
  scheduledJobId: string;
}

export interface TaskData {
  channelId: string;
  task: string;
  scheduledJobId: string;
}

export interface RecurrentTaskData {
  channelId: string;
  task: string;
  scheduledJobId: string;
}

export interface ProactiveCheckData {
  type: 'idle-engagement';
}

export interface SkillExecutionData {
  skillId: string;
  input: string;
  timeoutMs: number;
  secrets?: Record<string, string>;
  _workspaceFiles?: string[];
}

export interface ToolExecutionData {
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
}

export interface AttachmentData {
  type: 'photo' | 'document' | 'audio' | 'video' | 'voice';
  filePath: string;
  fileName: string;
  mimeType?: string;
}

export interface MessageProcessingData {
  channelId: string;
  text: string;
  attachments?: AttachmentData[];
}

export interface CommandData {
  channelId: string;
  text: string;
}

export interface MemoryExtractionData {
  channelId: string;
  texts: string[];
}

export interface VaultKeyRotationData {
  trigger: 'scheduled';
}

export type JobData =
  | AgentTaskData
  | ReminderData
  | RecurrentReminderData
  | TaskData
  | RecurrentTaskData
  | ProactiveCheckData
  | SkillExecutionData
  | MessageProcessingData
  | CommandData
  | ToolExecutionData
  | MemoryExtractionData
  | VaultKeyRotationData;

export type JobName =
  | 'message-processing'
  | 'command'
  | 'agent-task'
  | 'tool-execution'
  | 'skill-execution'
  | 'proactive-check'
  | 'reminder'
  | 'recurrent-reminder'
  | 'task'
  | 'recurrent-task'
  | 'memory-extraction'
  | 'vault-key-rotation';

// ─── Job → Queue Routing ───

export const JOB_QUEUE_MAP: Record<JobName, QueueName> = {
  'message-processing': 'scalyclaw-messages',
  'command':            'scalyclaw-messages',
  'agent-task':         'scalyclaw-agents',
  'tool-execution':     'scalyclaw-tools',
  'skill-execution':    'scalyclaw-tools',
  'proactive-check':    'scalyclaw-internal',
  'reminder':           'scalyclaw-internal',
  'recurrent-reminder': 'scalyclaw-internal',
  'task':               'scalyclaw-internal',
  'recurrent-task':     'scalyclaw-internal',
  'memory-extraction':  'scalyclaw-internal',
  'vault-key-rotation': 'scalyclaw-internal',
};

// ─── Job Spec ───

export interface JobSpec {
  name: JobName;
  data: JobData;
  opts: {
    priority?: number;
    attempts?: number;
    backoff?: { type: string; delay: number };
    delay?: number;
    repeat?: { pattern?: string; every?: number; tz?: string } | null;
    jobId?: string;
  };
}
