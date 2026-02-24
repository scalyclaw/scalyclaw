import type { FastifyInstance } from 'fastify';
import { checkBudget, buildModelPricing } from '../core/budget.js';
import { getCostStats } from '../core/db.js';

export function registerBudgetRoutes(server: FastifyInstance): void {
  server.get('/api/budget', async () => {
    const status = checkBudget();
    const pricing = buildModelPricing();
    const stats = getCostStats(pricing);
    return { ...status, stats };
  });
}
