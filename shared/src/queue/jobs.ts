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

/** Fired by schedule-worker when a reminder/recurring/task job fires → system queue */
export interface ScheduledFireData {
  channelId: string;
  type: 'reminder' | 'recurrent-reminder' | 'task' | 'recurrent-task';
  message: string;
  task?: string;
  scheduledJobId: string;
}

/** Fired by proactive-worker when a proactive message is generated → system queue */
export interface ProactiveFireData {
  channelId: string;
  message: string;
  triggerType: string;
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
  | ScheduledFireData
  | ProactiveFireData;

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
  | 'scheduled-fire'
  | 'proactive-fire';

// ─── Job → Queue Routing ───

export const JOB_QUEUE_MAP: Record<JobName, QueueName> = {
  'message-processing': 'scalyclaw-messages',
  'command':            'scalyclaw-messages',
  'agent-task':         'scalyclaw-agents',
  'tool-execution':     'scalyclaw-tools',
  'skill-execution':    'scalyclaw-tools',
  'proactive-check':    'scalyclaw-proactive',
  'reminder':             'scalyclaw-scheduler',
  'recurrent-reminder':  'scalyclaw-scheduler',
  'task':                'scalyclaw-scheduler',
  'recurrent-task':      'scalyclaw-scheduler',
  'memory-extraction':  'scalyclaw-system',
  'scheduled-fire':     'scalyclaw-system',
  'proactive-fire':     'scalyclaw-system',
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
