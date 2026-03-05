import { log } from '@scalyclaw/shared/core/logger.js';
import { createReminder, createRecurrentReminder, createTask, createRecurrentTask, listReminders, listTasks, cancelReminder, cancelTask } from '../../scheduler/scheduler.js';
import type { ToolContext } from '../tool-registry.js';

// ─── Delay/repeat parsing helpers ───

/** Parse a delay value that may be milliseconds (number), seconds (number < 1000), or human-readable ("30s", "5m", "1h") */
export function parseDelay(raw: unknown): number | null {
  if (raw == null) return null;
  const str = String(raw).trim().toLowerCase();
  const match = str.match(/^(\d+(?:\.\d+)?)\s*(ms|s|sec|seconds?|m|min|minutes?|h|hours?|d|days?)$/);
  if (match) {
    const val = parseFloat(match[1]);
    const unit = match[2];
    if (unit === 'ms') return val;
    if (unit.startsWith('s')) return val * 1000;
    if (unit.startsWith('m')) return val * 60_000;
    if (unit.startsWith('h')) return val * 3_600_000;
    if (unit.startsWith('d')) return val * 86_400_000;
  }
  const num = Number(raw);
  if (!Number.isFinite(num) || num <= 0) return null;
  // Heuristic: if < 1000, treat as seconds (models often confuse ms/s)
  return num < 1000 ? num * 1000 : num;
}

/** Parse absolute or relative delay from input fields */
export function parseScheduleDelay(input: Record<string, unknown>): { delayMs: number } | { error: string } {
  if (input.at != null) {
    const target = new Date(input.at as string);
    if (isNaN(target.getTime())) {
      return { error: `Invalid datetime for "at": ${input.at}. Use ISO-8601 format (e.g. "2026-02-23T15:00:00Z").` };
    }
    const delayMs = target.getTime() - Date.now();
    if (delayMs <= 0) return { error: `The time "${input.at}" is in the past.` };
    return { delayMs };
  }
  const parsed = parseDelay(input.delayMs);
  if (parsed != null) return { delayMs: parsed };
  return { error: 'Missing required field: either "delayMs" (milliseconds) or "at" (ISO-8601 datetime). Example: { "message": "...", "delayMs": 30000 }' };
}

/** Parse cron/interval from input fields */
export function parseScheduleRepeat(input: Record<string, unknown>): { cron?: string; intervalMs?: number } | { error: string } {
  const cron = input.cron as string | undefined || undefined;
  const parsedInterval = parseDelay(input.intervalMs);
  const intervalMs = parsedInterval ?? undefined;
  if (!cron && !intervalMs) {
    return { error: 'Missing required field: either "cron" (e.g. "*/5 * * * *") or "intervalMs" (e.g. 300000 for 5 min). Example: { "task": "...", "cron": "*/5 * * * *" }' };
  }
  return { cron: cron || undefined, intervalMs: cron ? undefined : intervalMs };
}

// ─── Scheduling handlers ───

export async function handleScheduleReminder(input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const message = input.message as string;
  if (!message) return JSON.stringify({ error: 'Missing required field: message (the reminder text)' });

  const delay = parseScheduleDelay(input);
  if ('error' in delay) return JSON.stringify({ error: delay.error });

  log('info', 'schedule_reminder', { message, delayMs: delay.delayMs, channelId: ctx.channelId });
  const jobId = await createReminder(ctx.channelId, message, delay.delayMs, (input.context as string) ?? '');
  return JSON.stringify({ scheduled: true, jobId, type: 'reminder', delayMs: delay.delayMs });
}

export async function handleScheduleRecurrentReminder(input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const task = input.task as string;
  if (!task) return JSON.stringify({ error: 'Missing required field: task (the recurrent reminder description)' });

  const repeat = parseScheduleRepeat(input);
  if ('error' in repeat) return JSON.stringify({ error: repeat.error });

  log('info', 'schedule_recurrent_reminder', { task, cron: repeat.cron, intervalMs: repeat.intervalMs, channelId: ctx.channelId });
  const jobId = await createRecurrentReminder(ctx.channelId, task, {
    cron: repeat.cron,
    intervalMs: repeat.intervalMs,
    timezone: (input.timezone as string) ?? undefined,
  });
  return JSON.stringify({ scheduled: true, jobId, task, type: 'recurrent-reminder' });
}

export async function handleScheduleTask(input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const task = input.task as string;
  if (!task) return JSON.stringify({ error: 'Missing required field: task (the task description)' });

  const delay = parseScheduleDelay(input);
  if ('error' in delay) return JSON.stringify({ error: delay.error });

  log('info', 'schedule_task', { task, delayMs: delay.delayMs, channelId: ctx.channelId });
  const jobId = await createTask(ctx.channelId, task, delay.delayMs);
  return JSON.stringify({ scheduled: true, jobId, type: 'task', delayMs: delay.delayMs });
}

export async function handleScheduleRecurrentTask(input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const task = input.task as string;
  if (!task) return JSON.stringify({ error: 'Missing required field: task (the recurrent task description)' });

  const repeat = parseScheduleRepeat(input);
  if ('error' in repeat) return JSON.stringify({ error: repeat.error });

  log('info', 'schedule_recurrent_task', { task, cron: repeat.cron, intervalMs: repeat.intervalMs, channelId: ctx.channelId });
  const jobId = await createRecurrentTask(ctx.channelId, task, {
    cron: repeat.cron,
    intervalMs: repeat.intervalMs,
    timezone: (input.timezone as string) ?? undefined,
  });
  return JSON.stringify({ scheduled: true, jobId, task, type: 'recurrent-task' });
}

export { listReminders, listTasks, cancelReminder, cancelTask };
