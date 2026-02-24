import type { FastifyInstance } from 'fastify';
import { getUsageStats, getCostStats } from '../core/db.js';
import { buildModelPricing } from '../core/budget.js';

export function registerUsageRoutes(server: FastifyInstance): void {
  server.get('/api/usage', async (request) => {
    const { from, to } = request.query as { from?: string; to?: string };
    const usage = getUsageStats(from, to);
    const pricing = buildModelPricing();
    const costStats = getCostStats(pricing, from, to);

    // Enrich byModel with cost data
    const byModel = usage.byModel.map((row) => {
      const costRow = costStats.byModel.find((c) => c.model === row.model && c.provider === row.provider);
      return {
        ...row,
        inputCost: costRow?.inputCost ?? 0,
        outputCost: costRow?.outputCost ?? 0,
        totalCost: costRow?.totalCost ?? 0,
      };
    });

    // Enrich byDay with cost data
    const byDay = usage.byDay.map((row) => {
      const costRow = costStats.byDay.find((c) => c.date === row.date);
      return { ...row, cost: costRow?.cost ?? 0 };
    });

    return {
      ...usage,
      byModel,
      byDay,
      totalCost: costStats.totalCost,
    };
  });
}
