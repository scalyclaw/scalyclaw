import { getConfigRef } from './config.js';
import { getCostStats, type ModelPricing } from './db.js';

export interface BudgetStatus {
  allowed: boolean;
  currentDayCost: number;
  currentMonthCost: number;
  dailyLimit: number;
  monthlyLimit: number;
  hardLimit: boolean;
  alerts: string[];
}

/** Build a model-pricing lookup from config */
export function buildModelPricing(): ModelPricing {
  const config = getConfigRef();
  const pricing: ModelPricing = {};
  for (const m of config.models.models) {
    pricing[m.id] = { inputPricePerMillion: m.inputPricePerMillion ?? 0, outputPricePerMillion: m.outputPricePerMillion ?? 0 };
  }
  for (const m of config.models.embeddingModels) {
    pricing[m.id] = { inputPricePerMillion: m.inputPricePerMillion ?? 0, outputPricePerMillion: m.outputPricePerMillion ?? 0 };
  }
  return pricing;
}

// ─── Cache ───

let cachedStatus: BudgetStatus | null = null;
let cachedAt = 0;
const CACHE_TTL_MS = 10_000; // 10s cache — avoids 4 SQL queries per orchestrator call

export function checkBudget(): BudgetStatus {
  const now = Date.now();
  if (cachedStatus && now - cachedAt < CACHE_TTL_MS) {
    return cachedStatus;
  }

  const config = getConfigRef();
  const budget = config.budget;
  const pricing = buildModelPricing();
  const stats = getCostStats(pricing);

  const alerts: string[] = [];
  let allowed = true;

  // Check daily limit
  if (budget.dailyLimit > 0) {
    const pct = (stats.currentDayCost / budget.dailyLimit) * 100;
    for (const threshold of budget.alertThresholds) {
      if (pct >= threshold) {
        alerts.push(`Daily spend at ${Math.round(pct)}% of $${budget.dailyLimit} limit`);
        break;
      }
    }
    if (stats.currentDayCost >= budget.dailyLimit && budget.hardLimit) {
      allowed = false;
    }
  }

  // Check monthly limit
  if (budget.monthlyLimit > 0) {
    const pct = (stats.currentMonthCost / budget.monthlyLimit) * 100;
    for (const threshold of budget.alertThresholds) {
      if (pct >= threshold) {
        alerts.push(`Monthly spend at ${Math.round(pct)}% of $${budget.monthlyLimit} limit`);
        break;
      }
    }
    if (stats.currentMonthCost >= budget.monthlyLimit && budget.hardLimit) {
      allowed = false;
    }
  }

  cachedStatus = {
    allowed,
    currentDayCost: stats.currentDayCost,
    currentMonthCost: stats.currentMonthCost,
    dailyLimit: budget.dailyLimit,
    monthlyLimit: budget.monthlyLimit,
    hardLimit: budget.hardLimit,
    alerts,
  };
  cachedAt = now;

  return cachedStatus;
}

/** Force-invalidate the budget cache (e.g. after config change) */
export function invalidateBudgetCache(): void {
  cachedStatus = null;
  cachedAt = 0;
}
