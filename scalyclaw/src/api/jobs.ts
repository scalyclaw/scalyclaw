import type { FastifyInstance } from 'fastify';
import { getQueue, getJobStatus, QUEUE_NAMES, type QueueKey } from '@scalyclaw/shared/queue/queue.js';
import { getRedis } from '@scalyclaw/shared/core/redis.js';
import { PENDING_KEY_PREFIX } from '../processors/message-processor.js';

export function registerJobsRoutes(server: FastifyInstance): void {
  // GET /api/jobs/queues — list available queue names
  server.get('/api/jobs/queues', async () => {
    return { queues: Object.keys(QUEUE_NAMES) };
  });

  // GET /api/jobs — list recent jobs from all queues (or filtered by queue)
  server.get<{ Querystring: { status?: string; limit?: string; queue?: string } }>('/api/jobs', async (request) => {
    const status = (request.query.status ?? 'completed') as 'completed' | 'failed' | 'active' | 'waiting' | 'delayed';
    const limit = Math.min(Number(request.query.limit) || 50, 200);
    const queueFilter = request.query.queue;

    const queueKeys = queueFilter
      ? [queueFilter as QueueKey]
      : Object.keys(QUEUE_NAMES) as QueueKey[];

    // BullMQ v5: jobs with priority > 0 go to 'prioritized', not 'wait'.
    // Merge both into the 'waiting' tab so users see all pending jobs.
    const statuses = status === 'waiting' ? ['waiting', 'prioritized'] : [status];

    const allJobs = await Promise.all(
      queueKeys.map(key => getQueue(key).getJobs(statuses as any, 0, limit - 1))
    );

    const jobs = allJobs
      .flat()
      .sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0))
      .slice(0, limit)
      .map(j => ({
        id: j.id,
        name: j.name,
        queue: j.queueName,
        status,
        data: j.data,
        timestamp: j.timestamp,
        processedOn: j.processedOn,
        finishedOn: j.finishedOn,
        failedReason: j.failedReason,
        returnvalue: j.returnvalue,
        attemptsMade: j.attemptsMade,
        attemptsStarted: j.attemptsStarted,
      }));

    return { jobs };
  });

  // GET /api/jobs/counts — job counts per queue per status
  server.get<{ Querystring: { queue?: string } }>('/api/jobs/counts', async (request) => {
    const queueFilter = request.query.queue;
    const queueKeys = queueFilter
      ? [queueFilter as QueueKey]
      : Object.keys(QUEUE_NAMES) as QueueKey[];

    const counts: Record<string, Record<string, number>> = {};
    await Promise.all(
      queueKeys.map(async (key) => {
        const q = getQueue(key);
        // BullMQ v5: jobs with priority > 0 go to 'prioritized', not 'waiting'.
        // Merge both into the 'waiting' count for the dashboard.
        const c = await q.getJobCounts('active', 'waiting', 'prioritized', 'completed', 'failed', 'delayed');
        counts[key] = {
          active: c.active ?? 0,
          waiting: (c.waiting ?? 0) + (c.prioritized ?? 0),
          completed: c.completed ?? 0,
          failed: c.failed ?? 0,
          delayed: c.delayed ?? 0,
        };
      }),
    );

    return { counts };
  });

  // GET /api/jobs/:id — get a specific job's status
  server.get<{ Params: { id: string } }>('/api/jobs/:id', async (request) => {
    return getJobStatus(request.params.id);
  });

  // DELETE /api/jobs/:queue/:id — remove a job
  server.delete<{ Params: { queue: string; id: string } }>('/api/jobs/:queue/:id', async (request, reply) => {
    const { queue: queueKey, id } = request.params;
    if (!(queueKey in QUEUE_NAMES)) return reply.status(400).send({ error: `Unknown queue: ${queueKey}` });

    const q = getQueue(queueKey as QueueKey);
    const job = await q.getJob(id);
    if (!job) return reply.status(404).send({ error: 'Job not found' });

    try {
      await job.remove();
    } catch {
      const state = await job.getState();
      if (state === 'active') {
        return reply.status(409).send({ error: 'Cannot remove active job. Fail it first.' });
      }
      return reply.status(500).send({ error: `Cannot remove job in state: ${state}` });
    }
    return { removed: true };
  });

  // POST /api/jobs/:queue/:id/retry — retry a failed job
  server.post<{ Params: { queue: string; id: string } }>('/api/jobs/:queue/:id/retry', async (request, reply) => {
    const { queue: queueKey, id } = request.params;
    if (!(queueKey in QUEUE_NAMES)) return reply.status(400).send({ error: `Unknown queue: ${queueKey}` });

    const q = getQueue(queueKey as QueueKey);
    const job = await q.getJob(id);
    if (!job) return reply.status(404).send({ error: 'Job not found' });

    await job.retry();
    return { retried: true };
  });

  // POST /api/jobs/:queue/:id/fail — move a job to failed state
  server.post<{ Params: { queue: string; id: string } }>('/api/jobs/:queue/:id/fail', async (request, reply) => {
    const { queue: queueKey, id } = request.params;
    if (!(queueKey in QUEUE_NAMES)) return reply.status(400).send({ error: `Unknown queue: ${queueKey}` });

    const q = getQueue(queueKey as QueueKey);
    const job = await q.getJob(id);
    if (!job) return reply.status(404).send({ error: 'Job not found' });

    const state = await job.getState();
    if (state === 'completed' || state === 'failed') {
      return reply.status(400).send({ error: `Job already in terminal state: ${state}` });
    }
    if (state === 'active') {
      await job.moveToFailed(new Error('Manually failed via dashboard'), '0', false);
      return { failed: true };
    }
    // waiting/delayed/prioritized — just remove
    await job.remove();
    return { failed: true, removed: true };
  });

  // POST /api/jobs/:queue/:id/complete — move a job to completed state
  server.post<{ Params: { queue: string; id: string } }>('/api/jobs/:queue/:id/complete', async (request, reply) => {
    const { queue: queueKey, id } = request.params;
    if (!(queueKey in QUEUE_NAMES)) return reply.status(400).send({ error: `Unknown queue: ${queueKey}` });

    const q = getQueue(queueKey as QueueKey);
    const job = await q.getJob(id);
    if (!job) return reply.status(404).send({ error: 'Job not found' });

    const state = await job.getState();
    if (state === 'completed' || state === 'failed') {
      return reply.status(400).send({ error: `Job already in terminal state: ${state}` });
    }
    if (state === 'active') {
      await job.moveToCompleted('Manually completed via dashboard', '0', false);
      return { completed: true };
    }
    // waiting/delayed/prioritized — just remove
    await job.remove();
    return { completed: true, removed: true };
  });

  // GET /api/pending — list pending messages across all channels
  server.get('/api/pending', async () => {
    const redis = getRedis();
    const keys = await redis.keys(`${PENDING_KEY_PREFIX}*`);
    const channels: Array<{ channelId: string; messages: Array<Record<string, unknown>> }> = [];

    for (const key of keys) {
      const channelId = key.slice(PENDING_KEY_PREFIX.length);
      const raw = await redis.lrange(key, 0, -1);
      const messages = raw.map((entry) => {
        try { return JSON.parse(entry); } catch { return { raw: entry }; }
      });
      if (messages.length > 0) {
        channels.push({ channelId, messages });
      }
    }

    return { channels };
  });
}
