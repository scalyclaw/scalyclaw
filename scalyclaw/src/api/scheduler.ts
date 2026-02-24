import type { FastifyInstance } from 'fastify';
import { listAllScheduledJobs, createReminder, createRecurrentReminder, createTask, createRecurrentTask, cancelScheduledJobAdmin, completeScheduledJobAdmin, deleteScheduledJob } from '../scheduler/scheduler.js';

export function registerSchedulerRoutes(server: FastifyInstance): void {
  // GET /api/scheduler — list all scheduled jobs across all channels (dashboard view)
  server.get('/api/scheduler', async () => {
    const jobs = await listAllScheduledJobs();
    return { jobs };
  });

  // POST /api/scheduler/reminder — create a one-off reminder
  server.post<{ Body: { description: string; runAt: string; context?: string } }>(
    '/api/scheduler/reminder',
    async (request, reply) => {
      const { description, runAt, context } = request.body ?? {};
      if (!description || !runAt) {
        return reply.status(400).send({ error: 'description and runAt are required' });
      }

      const runAtMs = new Date(runAt).getTime();
      if (isNaN(runAtMs)) {
        return reply.status(400).send({ error: 'runAt must be a valid ISO date string' });
      }
      const delayMs = runAtMs - Date.now();
      if (delayMs <= 0) {
        return reply.status(400).send({ error: 'runAt must be in the future' });
      }

      const jobId = await createReminder('gateway', description, delayMs, context ?? '');
      return { jobId };
    },
  );

  // POST /api/scheduler/recurrent-reminder — create a recurrent reminder
  server.post<{ Body: { description: string; cron?: string; intervalMs?: number; timezone?: string } }>(
    '/api/scheduler/recurrent-reminder',
    async (request, reply) => {
      const { description, cron, intervalMs, timezone } = request.body ?? {};
      if (!description) return reply.status(400).send({ error: 'description is required' });
      if (!cron && !intervalMs) return reply.status(400).send({ error: 'Either cron or intervalMs is required' });

      const jobId = await createRecurrentReminder('gateway', description, { cron, intervalMs, timezone });
      return { jobId };
    },
  );

  // POST /api/scheduler/task — create a one-shot task
  server.post<{ Body: { description: string; runAt: string } }>(
    '/api/scheduler/task',
    async (request, reply) => {
      const { description, runAt } = request.body ?? {};
      if (!description || !runAt) {
        return reply.status(400).send({ error: 'description and runAt are required' });
      }

      const runAtMs = new Date(runAt).getTime();
      if (isNaN(runAtMs)) {
        return reply.status(400).send({ error: 'runAt must be a valid ISO date string' });
      }
      const delayMs = runAtMs - Date.now();
      if (delayMs <= 0) {
        return reply.status(400).send({ error: 'runAt must be in the future' });
      }

      const jobId = await createTask('gateway', description, delayMs);
      return { jobId };
    },
  );

  // POST /api/scheduler/recurrent-task — create a recurrent task
  server.post<{ Body: { description: string; cron?: string; intervalMs?: number; timezone?: string } }>(
    '/api/scheduler/recurrent-task',
    async (request, reply) => {
      const { description, cron, intervalMs, timezone } = request.body ?? {};
      if (!description) return reply.status(400).send({ error: 'description is required' });
      if (!cron && !intervalMs) return reply.status(400).send({ error: 'Either cron or intervalMs is required' });

      const jobId = await createRecurrentTask('gateway', description, { cron, intervalMs, timezone });
      return { jobId };
    },
  );

  // DELETE /api/scheduler/:id — cancel a scheduled job (admin — no channel restriction)
  server.delete<{ Params: { id: string } }>('/api/scheduler/:id', async (request, reply) => {
    const cancelled = await cancelScheduledJobAdmin(request.params.id);
    if (!cancelled) return reply.status(404).send({ error: 'Scheduled job not found' });
    return { cancelled: true };
  });

  // POST /api/scheduler/:id/complete — complete an active scheduled job
  server.post<{ Params: { id: string } }>('/api/scheduler/:id/complete', async (request, reply) => {
    const completed = await completeScheduledJobAdmin(request.params.id);
    if (!completed) return reply.status(404).send({ error: 'Job not found or not active' });
    return { completed: true };
  });

  // DELETE /api/scheduler/:id/purge — permanently delete a non-active scheduled job
  server.delete<{ Params: { id: string } }>('/api/scheduler/:id/purge', async (request, reply) => {
    const deleted = await deleteScheduledJob(request.params.id);
    if (!deleted) return reply.status(404).send({ error: 'Job not found or still active' });
    return { deleted: true };
  });
}
