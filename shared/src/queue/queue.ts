import { Queue, QueueEvents, type QueueOptions } from 'bullmq';
import { log } from '../core/logger.js';
import type { JobSpec, JobName } from './jobs.js';
import { JOB_QUEUE_MAP } from './jobs.js';

// ─── Queue Names ───

export const QUEUE_NAMES = {
  messages:   'scalyclaw-messages',
  agents:     'scalyclaw-agents',
  tools:      'scalyclaw-tools',
  proactive:  'scalyclaw-proactive',
  scheduler:  'scalyclaw-scheduler',
  system:     'scalyclaw-system',
} as const;

export type QueueKey = keyof typeof QUEUE_NAMES;
export type QueueName = typeof QUEUE_NAMES[QueueKey];

// ─── State ───

const queues = new Map<QueueName, Queue>();
const queueEvents = new Map<QueueName, QueueEvents>();

export interface QueueConfig {
  lockDuration: number;
  stalledInterval: number;
  limiter: { max: number; duration: number };
  removeOnComplete: { age: number; count: number };
  removeOnFail: { age: number };
}

// ─── Init ───

// Only tools and agents queues use waitUntilFinished (via enqueueAndWait)
const QUEUES_NEEDING_EVENTS = new Set<QueueName>([QUEUE_NAMES.tools, QUEUE_NAMES.agents]);

export function initQueue(connection: { duplicate(): unknown }, config: QueueConfig): void {
  const defaultJobOptions = {
    removeOnComplete: config.removeOnComplete,
    removeOnFail: config.removeOnFail,
  };

  for (const [key, name] of Object.entries(QUEUE_NAMES)) {
    const q = new Queue(name, {
      connection: connection.duplicate() as QueueOptions['connection'],
      defaultJobOptions,
    });
    queues.set(name, q);

    if (QUEUES_NEEDING_EVENTS.has(name as QueueName)) {
      const ev = new QueueEvents(name, {
        connection: connection.duplicate() as QueueOptions['connection'],
      });
      queueEvents.set(name, ev);
    }
  }

  log('info', 'BullMQ queues initialized', { queues: Object.values(QUEUE_NAMES) });
}

// ─── Accessors ───

export function getQueue(key: QueueKey): Queue {
  const name = QUEUE_NAMES[key];
  const q = queues.get(name);
  if (!q) throw new Error(`Queue "${name}" not initialized — call initQueue first`);
  return q;
}

export function getQueueByName(name: QueueName): Queue {
  const q = queues.get(name);
  if (!q) throw new Error(`Queue "${name}" not initialized — call initQueue first`);
  return q;
}

export function getQueueEvents(key: QueueKey): QueueEvents {
  const name = QUEUE_NAMES[key];
  const ev = queueEvents.get(name);
  if (!ev) throw new Error(`QueueEvents "${name}" not initialized — call initQueue first`);
  return ev;
}

/** Get the queue name for a given queue key */
export function getQueueName(key: QueueKey): QueueName {
  return QUEUE_NAMES[key];
}

// ─── Enqueue ───

export async function enqueueJob(spec: JobSpec): Promise<string> {
  const queueName = JOB_QUEUE_MAP[spec.name];
  if (!queueName) throw new Error(`No queue mapping for job "${spec.name}"`);

  const q = getQueueByName(queueName);

  // Repeatable jobs → use upsertJobScheduler (BullMQ v5 recommended API)
  if (spec.opts.repeat && spec.opts.jobId) {
    const repeat = spec.opts.repeat.every
      ? { every: spec.opts.repeat.every }
      : { pattern: spec.opts.repeat.pattern!, ...(spec.opts.repeat.tz ? { tz: spec.opts.repeat.tz } : {}) };

    await q.upsertJobScheduler(spec.opts.jobId, repeat, {
      name: spec.name,
      data: spec.data,
      opts: {
        attempts: spec.opts.attempts,
        backoff: spec.opts.backoff as { type: 'exponential' | 'fixed'; delay: number },
      },
    });

    log('info', `Job scheduler upserted: ${spec.name}`, { jobId: spec.opts.jobId, queue: q.name });
    return spec.opts.jobId;
  }

  // One-off jobs (reminders, messages, agents, etc.) — normal Queue.add()
  const job = await q.add(spec.name, spec.data, {
    priority: spec.opts.priority,
    attempts: spec.opts.attempts,
    backoff: spec.opts.backoff as { type: 'exponential' | 'fixed'; delay: number },
    delay: spec.opts.delay,
    jobId: spec.opts.jobId,
  });

  log('info', `Job enqueued: ${spec.name}`, { jobId: job.id, queue: q.name });
  return job.id!;
}

// ─── Job Status ───

export async function getJobStatus(jobId: string): Promise<{ id: string; state: string; progress: unknown; data: Record<string, unknown> }> {
  // Search all queues in parallel
  const results = await Promise.all(
    [...queues.values()].map(async (q) => {
      const job = await q.getJob(jobId);
      if (!job) return null;
      const state = await job.getState();
      return {
        id: job.id!,
        state,
        progress: job.progress as unknown,
        data: job.data as Record<string, unknown>,
      };
    })
  );
  return results.find(r => r !== null) ?? { id: jobId, state: 'not_found', progress: 0, data: {} };
}

// ─── Remove Repeatable ───

export async function removeRepeatableJob(jobId: string, targetQueueKey?: QueueKey): Promise<boolean> {
  const queuesToSearch = targetQueueKey
    ? [getQueue(targetQueueKey)]
    : [...queues.values()];

  for (const q of queuesToSearch) {
    try {
      // 1. Try direct job lookup (one-off delayed jobs like reminders)
      const job = await q.getJob(jobId);
      if (job) {
        await job.remove();
        return true;
      }

      // 2. Remove job scheduler (repeatable) by ID
      const removed = await q.removeJobScheduler(jobId);
      if (removed) {
        log('info', 'Removed job scheduler', { jobId, queue: q.name });
        return true;
      }
    } catch {
      // continue to next queue
    }
  }

  log('warn', 'Could not find job to remove', { jobId });
  return false;
}

// ─── Close ───

export async function closeQueue(): Promise<void> {
  for (const [name, ev] of queueEvents) {
    await ev.close();
  }
  queueEvents.clear();

  for (const [name, q] of queues) {
    await q.close();
  }
  queues.clear();
}
