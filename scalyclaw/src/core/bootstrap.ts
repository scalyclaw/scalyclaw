import { ensureDirectories, syncMindFiles, setBasePath, PATHS, loadSetupConfig } from './paths.js';
import { initRedis, getRedis, createRedisClient, type RedisConfig } from '@scalyclaw/shared/core/redis.js';
import { loadConfig, getConfigRef, subscribeToConfigReload, type ScalyClawConfig } from './config.js';
import { resolveSecrets } from './vault.js';
import { ensurePasswordFile } from './vault-crypto.js';
import { initLogger, log } from '@scalyclaw/shared/core/logger.js';
import { initDatabase } from './db.js';
import { initEmbeddings, getEmbeddingDimensions } from '../memory/embeddings.js';
import { loadSkills } from '@scalyclaw/shared/skills/skill-loader.js';
import { subscribeToSkillReload } from '../skills/skill-store.js';
import { loadAllAgents } from '../agents/agent-loader.js';
import { connectAll as connectMcpServers } from '../mcp/mcp-manager.js';
import { invalidatePromptCache } from '../prompt/builder.js';
import { registerProvider } from '../models/registry.js';
import { createMiniMaxProvider } from '../models/providers/minimax.js';
import { initQueue } from '@scalyclaw/shared/queue/queue.js';
import { subscribeToCancelSignal } from '@scalyclaw/shared/queue/cancel-signal.js';
import type { Redis } from 'ioredis';

export interface BootstrapOptions {
  /** Copy mind/ reference docs from source to data dir (main process only) */
  syncMind?: boolean;
  /** Skip SQLite database and embeddings initialization (for worker processes that don't need DB access) */
  skipDatabase?: boolean;
  /** Additional handler called after config is hot-reloaded (e.g. channel re-init in main process) */
  onConfigReload?: (config: ScalyClawConfig, channelsChanged: boolean) => void | Promise<void>;
}

export interface BootstrapResult {
  resolvedConfig: ScalyClawConfig;
  redis: Redis;
  redisConfig: RedisConfig;
  reloadSubscriber: Redis | null;
}

export async function bootstrap(options: BootstrapOptions = {}): Promise<BootstrapResult> {
  // ── Setup config (scalyclaw.json) ──
  const setupConfig = loadSetupConfig();
  setBasePath(setupConfig.homeDir);

  // ── Redis ──
  const redisConfig: RedisConfig = {
    host: setupConfig.redis.host,
    port: setupConfig.redis.port,
    password: setupConfig.redis.password,
    tls: setupConfig.redis.tls,
  };
  await initRedis(redisConfig);

  // ── Config ──
  await loadConfig();
  const config = getConfigRef();

  // ── Data directory ──
  ensureDirectories();
  if (options.syncMind) {
    syncMindFiles();
  }
  log('info', 'Data directory', { base: PATHS.base });

  // ── Vault password file (must exist before any decrypt) ──
  ensurePasswordFile();

  // ── Secrets + Logger ──
  const resolvedConfig = await resolveSecrets(config) as ScalyClawConfig;
  initLogger(resolvedConfig.logs);
  log('info', 'Logger initialized');

  // ── Queues ──
  const redis = getRedis();
  initQueue(redis, resolvedConfig.queue);

  // ── Embeddings + Database (skip for worker processes) ──
  if (!options.skipDatabase) {
    try {
      await initEmbeddings();
    } catch (err) {
      log('warn', 'Embeddings initialization failed — memory search will be unavailable', { error: String(err) });
    }

    initDatabase(PATHS.dbFile, getEmbeddingDimensions() || 1536);
  } else {
    log('info', 'Skipping database initialization (skipDatabase=true)');
  }

  // ── Skills + Agents + MCP (parallel — independent of each other) ──
  await Promise.all([
    loadSkills(),
    loadAllAgents(),
    connectMcpServers(resolvedConfig.mcpServers ?? {}),
  ]);

  // ── Model Providers ──
  const providers = resolvedConfig.models.providers;
  if (providers.minimax?.apiKey) {
    registerProvider(createMiniMaxProvider(providers.minimax.apiKey, providers.minimax.baseUrl));
    log('info', 'Registered provider: minimax');
  }

  // ── Reload Subscriptions ──
  const reloadSubscriber = createRedisClient(redisConfig);
  await reloadSubscriber.connect();
  subscribeToSkillReload(reloadSubscriber, async () => {
    log('info', 'Received skills reload notification, reloading from disk');
    await loadSkills();
    invalidatePromptCache();
  });
  subscribeToCancelSignal(reloadSubscriber);
  // Track channels independently — saveConfig() updates the shared cache before
  // this reload handler fires (same process), so getConfigRef().channels is already
  // stale by the time we read it.  Keep our own snapshot updated only here.
  let lastChannelsJson = JSON.stringify(getConfigRef().channels);

  subscribeToConfigReload(reloadSubscriber, async () => {
    log('info', 'Received config reload notification');
    invalidatePromptCache();

    const oldChannelsJson = lastChannelsJson;

    const freshConfig = await loadConfig();
    const resolved = await resolveSecrets(freshConfig) as ScalyClawConfig;

    // Compare against our own snapshot (unaffected by saveConfig cache update)
    lastChannelsJson = JSON.stringify(freshConfig.channels);
    const channelsChanged = lastChannelsJson !== oldChannelsJson;

    // Re-init logger (level/format)
    initLogger(resolved.logs);
    log('info', 'Logger re-initialized after config reload', { channelsChanged });

    // Re-init embeddings (model/provider may have changed) — skip for workers
    if (!options.skipDatabase) {
      try {
        await initEmbeddings();
      } catch (err) {
        log('warn', 'Embeddings re-init failed after config reload', { error: String(err) });
      }
    }

    // Re-register model providers
    const provs = resolved.models.providers;
    if (provs.minimax?.apiKey) {
      registerProvider(createMiniMaxProvider(provs.minimax.apiKey, provs.minimax.baseUrl));
    }

    // Process-specific handler (e.g. channel reload in main process)
    if (options.onConfigReload) {
      await options.onConfigReload(resolved, channelsChanged);
    }
  });

  return { resolvedConfig, redis, redisConfig, reloadSubscriber };
}
