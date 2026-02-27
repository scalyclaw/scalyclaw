import type { Job } from 'bullmq';
import { log } from '@scalyclaw/shared/core/logger.js';
import { enqueueJob } from '@scalyclaw/shared/queue/queue.js';
import { processProactiveEngagement } from '../scheduler/proactive.js';
import type { ProactiveCheckData } from '@scalyclaw/shared/queue/jobs.js';

// ─── Proactive job processor (scalyclaw-proactive queue) ───

export async function processProactiveJob(job: Job<ProactiveCheckData>): Promise<void> {
  log('debug', 'Running proactive engagement check', { jobId: job.id });

  const results = await processProactiveEngagement();

  // For each proactive message, enqueue a proactive-fire job on the system queue
  for (const result of results) {
    try {
      await enqueueJob({
        name: 'proactive-fire',
        data: {
          channelId: result.channelId,
          message: result.message,
          triggerType: result.triggerType,
        },
        opts: {
          attempts: 2,
          backoff: { type: 'fixed', delay: 2000 },
        },
      });

      log('info', 'Proactive message → proactive-fire enqueued', {
        channelId: result.channelId,
        triggerType: result.triggerType,
      });
    } catch (err) {
      log('error', 'Failed to enqueue proactive-fire', {
        channelId: result.channelId,
        error: String(err),
      });
    }
  }

  log('debug', 'Proactive engagement check done', { jobId: job.id, sent: results.length });
}
