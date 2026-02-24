#!/usr/bin/env bun

import { Command } from 'commander';
import { readFileSync, mkdirSync, openSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import type { Redis } from 'ioredis';
import type { ProcessInfo } from '@scalyclaw/scalyclaw/core/registry.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

type ProcessType = 'node' | 'worker' | 'dashboard';

function getVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(resolve(__dirname, '..', 'package.json'), 'utf-8'));
    return pkg.version;
  } catch {
    return '0.1.0';
  }
}

// ─── Redis helpers ──────────────────────────────────────────────────

/** Quick one-shot Redis connection using scalyclaw.json config */
async function withRedis<T>(fn: (redis: Redis) => Promise<T>): Promise<T> {
  const { loadSetupConfig } = await import('@scalyclaw/scalyclaw/core/paths.js');
  const { createRedisClient } = await import('@scalyclaw/scalyclaw/core/redis.js');
  const setupConfig = loadSetupConfig();
  const redis = createRedisClient({
    host: setupConfig.redis.host,
    port: setupConfig.redis.port,
    password: setupConfig.redis.password,
    tls: setupConfig.redis.tls,
  });
  await redis.connect();
  try {
    return await fn(redis);
  } finally {
    redis.disconnect();
  }
}

// ─── Worker name helpers ────────────────────────────────────────────

/** Resolve worker config path from a name alias */
function workerConfigPath(name: string): string {
  return join(homedir(), `.scalyclaw-worker-${name}`, 'worker.json');
}

/** Quick one-shot Redis connection, falling back to any worker config if scalyclaw.json is missing */
async function withAnyRedis<T>(fn: (redis: Redis) => Promise<T>): Promise<T> {
  const { createRedisClient } = await import('@scalyclaw/scalyclaw/core/redis.js');

  // Try scalyclaw.json first
  try {
    const { loadSetupConfig } = await import('@scalyclaw/scalyclaw/core/paths.js');
    const setupConfig = loadSetupConfig();
    const redis = createRedisClient({
      host: setupConfig.redis.host,
      port: setupConfig.redis.port,
      password: setupConfig.redis.password,
      tls: setupConfig.redis.tls,
    });
    await redis.connect();
    try { return await fn(redis); } finally { redis.disconnect(); }
  } catch { /* scalyclaw.json missing — try worker configs */ }

  // Scan for any ~/.scalyclaw-worker-*/worker.json
  const home = homedir();
  const entries = readdirSync(home, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name.startsWith('.scalyclaw-worker-')) {
      const configFile = join(home, entry.name, 'worker.json');
      if (existsSync(configFile)) {
        try {
          const raw = JSON.parse(readFileSync(configFile, 'utf-8'));
          const redis = createRedisClient({
            host: raw.redis.host,
            port: raw.redis.port,
            password: raw.redis.password,
            tls: raw.redis.tls,
          });
          await redis.connect();
          try { return await fn(redis); } finally { redis.disconnect(); }
        } catch { continue; }
      }
    }
  }

  throw new Error('No scalyclaw.json or worker config found. Run setup first.');
}

/** Get registered processes from Redis, optionally filtered by type */
async function getProcesses(redis: Redis, typeFilter?: ProcessType): Promise<ProcessInfo[]> {
  const { listProcesses } = await import('@scalyclaw/scalyclaw/core/registry.js');
  let processes = await listProcesses(redis);
  if (typeFilter) {
    processes = processes.filter(p => p.type === typeFilter);
  }
  return processes;
}

// ─── HTTP-based process helpers ─────────────────────────────────────

/** Check if a process is reachable via HTTP */
async function isReachable(host: string, port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://${host}:${port}/health`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch { return false; }
}

/** Wait for a process to become unreachable (up to timeoutMs). Returns true if unreachable. */
async function waitForUnreachable(host: string, port: number, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!(await isReachable(host, port))) return true;
    await new Promise(r => setTimeout(r, 500));
  }
  return !(await isReachable(host, port));
}

/** Read the node gateway auth token from Redis config */
async function getNodeAuthToken(redis: Redis): Promise<string | null> {
  const raw = await redis.get('scalyclaw:config');
  if (!raw) return null;
  try {
    const config = JSON.parse(raw);
    return config.gateway?.authValue ?? null;
  } catch { return null; }
}

/** Send HTTP shutdown to a process and wait for it to become unreachable */
async function shutdownProcess(proc: ProcessInfo, authToken?: string | null): Promise<void> {
  const headers: Record<string, string> = {};
  const token = authToken ?? proc.authToken;
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const shutdownUrl = proc.type === 'dashboard'
    ? `http://${proc.host}:${proc.port}/api/dashboard/shutdown`
    : `http://${proc.host}:${proc.port}/api/shutdown`;

  try {
    await fetch(shutdownUrl, {
      method: 'POST',
      headers,
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // Process might already be dead
  }

  await waitForUnreachable(proc.host, proc.port, 10_000);
}

/** Stop all processes of the given type via HTTP shutdown */
async function stopProcesses(type: ProcessType): Promise<void> {
  await withRedis(async (redis) => {
    const { deregisterProcessByKey } = await import('@scalyclaw/scalyclaw/core/registry.js');
    const processes = await getProcesses(redis, type);

    if (processes.length === 0) {
      console.log(`No registered ${type} processes found.`);
      return;
    }

    // For node, we need the gateway auth token from Redis config
    let nodeAuthToken: string | null = null;
    if (type === 'node') {
      nodeAuthToken = await getNodeAuthToken(redis);
    }

    for (const p of processes) {
      const reachable = await isReachable(p.host, p.port);
      if (!reachable) {
        console.log(`${type} at ${p.host}:${p.port} is not reachable. Cleaning up registry.`);
        await deregisterProcessByKey(redis, p.id);
        continue;
      }

      console.log(`Stopping ${type} at ${p.host}:${p.port}...`);
      await shutdownProcess(p, type === 'node' ? nodeAuthToken : undefined);
      await deregisterProcessByKey(redis, p.id);
      console.log(`  ${p.host}:${p.port} stopped.`);
    }
  });
}

/** Spawn a detached background process */
function startBackground(args: string[], logFileName: string): string {
  const { PATHS } = require('@scalyclaw/scalyclaw/core/paths.js') as typeof import('@scalyclaw/scalyclaw/core/paths.js');
  const logDir = PATHS.logs;
  mkdirSync(logDir, { recursive: true });
  const logPath = resolve(logDir, logFileName);

  const fd = openSync(logPath, 'w', 0o600);
  const child = Bun.spawn(['bun', resolve(__dirname, 'cli.ts'), ...args], {
    stdio: [null, fd, fd],
  });
  child.unref();

  console.log(`Started in background (PID: ${child.pid})`);
  console.log(`Log: ${logPath}`);

  return logPath;
}

// ─── Status ─────────────────────────────────────────────────────────

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

async function showStatus(typeFilter?: ProcessType): Promise<void> {
  await withRedis(async (redis) => {
    const { deregisterProcessByKey } = await import('@scalyclaw/scalyclaw/core/registry.js');
    const processes = await getProcesses(redis, typeFilter);

    // Check reachability and clean up stale entries
    const reachableProcesses: ProcessInfo[] = [];
    for (const p of processes) {
      if (await isReachable(p.host, p.port)) {
        reachableProcesses.push(p);
      } else {
        await deregisterProcessByKey(redis, p.id);
      }
    }

    if (reachableProcesses.length === 0) {
      const scope = typeFilter ? `${typeFilter} ` : '';
      console.log(`No ${scope}ScalyClaw processes running.`);
      return;
    }

    console.log('');
    for (const p of reachableProcesses) {
      const icon = '\x1b[32m●\x1b[0m';
      const status = '\x1b[32mrunning\x1b[0m';
      const typeLabels: Record<string, string> = { node: 'Node', worker: 'Worker', dashboard: 'Dashboard' };
      const typeLabel = typeLabels[p.type] ?? p.type;

      console.log(`  ${icon} ${typeLabel}  ${status}  (${p.host}:${p.port})`);
      console.log(`    ID:          ${p.id}`);
      console.log(`    Host:        ${p.hostname}`);
      console.log(`    Uptime:      ${formatUptime(p.uptime)}`);
      console.log(`    Started:     ${p.startedAt}`);
      console.log(`    Version:     ${p.version}`);
      if (p.concurrency) {
        console.log(`    Concurrency: ${p.concurrency}`);
      }
      console.log('');
    }
  });
}

// ─── Setup ──────────────────────────────────────────────────────────

async function runSetup(): Promise<void> {
  const p = await import('@clack/prompts');
  const pc = (await import('picocolors')).default;
  const IoRedis = (await import('ioredis')).Redis;
  const { writeSetupConfig, PATHS } = await import('@scalyclaw/scalyclaw/core/paths.js');
  const { existsSync } = await import('node:fs');

  p.intro(pc.bold('ScalyClaw Setup'));

  // Check for existing config
  if (existsSync(PATHS.configFile)) {
    const overwrite = await p.confirm({
      message: `Config already exists at ${PATHS.configFile}. Overwrite?`,
      initialValue: false,
    });
    if (p.isCancel(overwrite) || !overwrite) {
      p.cancel('Setup cancelled.');
      process.exit(0);
    }
  }

  // Data directory
  const homeDir = await p.text({
    message: 'Home directory',
    placeholder: '~/.scalyclaw',
    initialValue: '~/.scalyclaw',
  });
  if (p.isCancel(homeDir)) { p.cancel('Setup cancelled.'); process.exit(0); }

  // Redis connection
  p.log.step(pc.cyan('Redis connection'));

  const redisGroup = await p.group({
    host: () => p.text({ message: 'Redis host', initialValue: 'localhost' }),
    port: () => p.text({
      message: 'Redis port',
      initialValue: '6379',
      validate: (v) => isNaN(Number(v)) ? 'Must be a number' : undefined,
    }),
    password: () => p.password({ message: 'Redis password (leave empty for none)' }),
    tls: () => p.confirm({ message: 'Use TLS?', initialValue: false }),
  }, { onCancel: () => { p.cancel('Setup cancelled.'); process.exit(0); } });

  const redisConfig = {
    host: redisGroup.host,
    port: Number(redisGroup.port),
    password: (typeof redisGroup.password === 'string' && redisGroup.password) ? redisGroup.password : null,
    tls: redisGroup.tls,
  };

  // Test Redis connection + seed default config if missing
  const spinner = p.spinner();
  spinner.start('Testing Redis connection...');
  let client: InstanceType<typeof IoRedis>;
  try {
    client = new IoRedis({
      host: redisConfig.host,
      port: redisConfig.port,
      password: redisConfig.password ?? undefined,
      tls: redisConfig.tls ? {} : undefined,
      maxRetriesPerRequest: 3,
      connectTimeout: 5000,
      lazyConnect: true,
    });
    await client.connect();
    await client.ping();
    spinner.stop(pc.green('Redis connection successful'));
  } catch (err) {
    spinner.stop(pc.red(`Redis connection failed: ${err}`));
    process.exit(1);
  }

  // Seed default scalyclaw:config if none exists
  const { CONFIG_DEFAULTS } = await import('@scalyclaw/scalyclaw/core/config.js');
  const CONFIG_KEY = 'scalyclaw:config';
  const existing = await client!.exists(CONFIG_KEY);
  if (!existing) {
    await client!.set(CONFIG_KEY, JSON.stringify(CONFIG_DEFAULTS, null, 2));
    p.log.info('Seeded default config in Redis');
  } else {
    p.log.info('Existing config found in Redis (kept)');
  }

  client!.disconnect();

  // Write config
  writeSetupConfig({
    homeDir: homeDir,
    redis: redisConfig,
  });

  p.log.success(`Config written to ${pc.cyan(PATHS.configFile)}`);
  p.outro(pc.dim('Run "bun run scalyclaw:node start" to start ScalyClaw.'));
}

// ─── Worker Setup ────────────────────────────────────────────────────

async function runWorkerSetup(name: string): Promise<void> {
  const p = await import('@clack/prompts');
  const pc = (await import('picocolors')).default;
  const IoRedis = (await import('ioredis')).Redis;
  const { writeWorkerSetupConfig } = await import('@scalyclaw/scalyclaw/core/paths.js');
  const { randomBytes } = await import('node:crypto');

  p.intro(pc.bold(`ScalyClaw Worker Setup (${name})`));

  const defaultDir = join(homedir(), `.scalyclaw-worker-${name}`);
  const configFile = join(defaultDir, 'worker.json');

  // Check for existing config
  if (existsSync(configFile)) {
    const overwrite = await p.confirm({
      message: `Worker config already exists at ${configFile}. Overwrite?`,
      initialValue: false,
    });
    if (p.isCancel(overwrite) || !overwrite) {
      p.cancel('Setup cancelled.');
      process.exit(0);
    }
  }

  // Home directory
  const homeDir = await p.text({
    message: 'Worker home directory',
    placeholder: defaultDir,
    initialValue: defaultDir,
  });
  if (p.isCancel(homeDir)) { p.cancel('Setup cancelled.'); process.exit(0); }

  // Worker gateway config
  p.log.step(pc.cyan('Worker API server'));

  const gatewayGroup = await p.group({
    host: () => p.text({ message: 'Bind address', initialValue: '127.0.0.1' }),
    port: () => p.text({
      message: 'Worker API port',
      initialValue: '3001',
      validate: (v) => isNaN(Number(v)) ? 'Must be a number' : undefined,
    }),
    tls: () => p.confirm({ message: 'Use TLS?', initialValue: false }),
  }, { onCancel: () => { p.cancel('Setup cancelled.'); process.exit(0); } });

  const authToken = `wk_${randomBytes(24).toString('base64url')}`;

  // Redis connection
  p.log.step(pc.cyan('Redis connection'));

  const redisGroup = await p.group({
    host: () => p.text({ message: 'Redis host', initialValue: 'localhost' }),
    port: () => p.text({
      message: 'Redis port',
      initialValue: '6379',
      validate: (v) => isNaN(Number(v)) ? 'Must be a number' : undefined,
    }),
    password: () => p.password({ message: 'Redis password (leave empty for none)' }),
    tls: () => p.confirm({ message: 'Use TLS?', initialValue: false }),
  }, { onCancel: () => { p.cancel('Setup cancelled.'); process.exit(0); } });

  const redisConfig = {
    host: redisGroup.host,
    port: Number(redisGroup.port),
    password: (typeof redisGroup.password === 'string' && redisGroup.password) ? redisGroup.password : null,
    tls: redisGroup.tls,
  };

  // Test Redis connection
  const spinner = p.spinner();
  spinner.start('Testing Redis connection...');
  try {
    const client = new IoRedis({
      host: redisConfig.host,
      port: redisConfig.port,
      password: redisConfig.password ?? undefined,
      tls: redisConfig.tls ? {} : undefined,
      maxRetriesPerRequest: 3,
      connectTimeout: 5000,
      lazyConnect: true,
    });
    await client.connect();
    await client.ping();
    client.disconnect();
    spinner.stop(pc.green('Redis connection successful'));
  } catch (err) {
    spinner.stop(pc.red(`Redis connection failed: ${err}`));
    process.exit(1);
  }

  // Node connection
  p.log.step(pc.cyan('Node connection'));

  const nodeUrl = await p.text({
    message: 'Node API URL',
    placeholder: 'http://localhost:3000',
    initialValue: 'http://localhost:3000',
  });
  if (p.isCancel(nodeUrl)) { p.cancel('Setup cancelled.'); process.exit(0); }

  const nodeToken = await p.text({
    message: 'Node gateway auth token',
    placeholder: 'your-gateway-auth-token',
  });
  if (p.isCancel(nodeToken)) { p.cancel('Setup cancelled.'); process.exit(0); }

  // Concurrency
  const concurrency = await p.text({
    message: 'Tool execution concurrency',
    initialValue: '3',
    validate: (v) => isNaN(Number(v)) || Number(v) < 1 ? 'Must be a positive number' : undefined,
  });
  if (p.isCancel(concurrency)) { p.cancel('Setup cancelled.'); process.exit(0); }

  // Write config
  writeWorkerSetupConfig({
    homeDir,
    gateway: {
      host: gatewayGroup.host,
      port: Number(gatewayGroup.port),
      tls: gatewayGroup.tls,
      authToken,
    },
    redis: redisConfig,
    node: {
      url: nodeUrl,
      token: nodeToken || '',
    },
    concurrency: Number(concurrency),
  });

  const resolvedHome = homeDir.startsWith('~/') || homeDir.startsWith('~\\')
    ? join(homedir(), homeDir.slice(2))
    : homeDir;
  p.log.success(`Worker config written to ${pc.cyan(join(resolvedHome, 'worker.json'))}`);
  p.log.info(`Worker auth token: ${pc.dim(authToken)}`);
  p.outro(pc.dim(`Run "bun run scalyclaw:worker start --name ${name}" to start the worker.`));
}

// ─── CLI ────────────────────────────────────────────────────────────

const program = new Command();

program
  .name('scalyclaw')
  .description('ScalyClaw — Multi-agent AI orchestration system')
  .version(getVersion());

// ─── scalyclaw node ─────────────────────────────────────────────────

const nodeCmd = program
  .command('node')
  .description('Manage the main ScalyClaw node process')
  .action(() => { nodeCmd.help(); });

nodeCmd
  .command('setup')
  .description('Interactive setup — configure data directory and Redis connection')
  .action(async () => { await runSetup(); });

nodeCmd
  .command('start')
  .description('Start the node process (foreground)')
  .option('-c, --concurrency <n>', 'Number of concurrent message processing jobs', '3')
  .action(async (opts) => {
    process.env.SCALYCLAW_CONCURRENCY = opts.concurrency;
    await import('@scalyclaw/scalyclaw');
  });

nodeCmd
  .command('stop')
  .description('Stop all running node processes')
  .action(async () => { await stopProcesses('node'); });

nodeCmd
  .command('restart')
  .description('Restart the node process (foreground)')
  .option('-c, --concurrency <n>', 'Number of concurrent message processing jobs', '3')
  .action(async (opts) => {
    await stopProcesses('node');
    process.env.SCALYCLAW_CONCURRENCY = opts.concurrency;
    await import('@scalyclaw/scalyclaw');
  });

nodeCmd
  .command('status')
  .description('Show status of node processes')
  .action(async () => { await showStatus('node'); });

nodeCmd
  .command('background')
  .description('Start the node process in the background')
  .option('-c, --concurrency <n>', 'Number of concurrent message processing jobs', '3')
  .action((opts) => {
    startBackground(['node', 'start', '-c', opts.concurrency], 'scalyclaw-node.log');
  });

// ─── scalyclaw worker ───────────────────────────────────────────────

const workerCmd = program
  .command('worker')
  .description('Manage ScalyClaw worker processes')
  .action(() => { workerCmd.help(); });

workerCmd
  .command('setup')
  .description('Configure worker — gateway, Redis, node URL, and workspace')
  .requiredOption('--name <name>', 'Worker instance name')
  .action(async (opts) => { await runWorkerSetup(opts.name); });

workerCmd
  .command('start')
  .description('Start a worker process (foreground)')
  .requiredOption('--name <name>', 'Worker instance name')
  .option('-c, --concurrency <n>', 'Tool execution concurrency override')
  .action(async (opts) => {
    process.env.SCALYCLAW_WORKER_CONFIG = workerConfigPath(opts.name);
    if (opts.concurrency) process.env.SCALYCLAW_WORKER_CONCURRENCY = opts.concurrency;
    await import('@scalyclaw/worker');
  });

workerCmd
  .command('stop')
  .description('Stop running worker processes (all, or a specific named worker)')
  .option('--name <name>', 'Worker instance name (omit to stop all)')
  .action(async (opts) => {
    if (opts.name) {
      // Read the named worker's config to get its host:port
      const configFile = workerConfigPath(opts.name);
      let raw: any;
      try {
        raw = JSON.parse(readFileSync(configFile, 'utf-8'));
      } catch {
        console.error(`Worker config not found: ${configFile}`);
        process.exit(1);
      }
      const hostPort = `${raw.gateway.host === '0.0.0.0' ? 'localhost' : raw.gateway.host}:${raw.gateway.port}`;
      await withAnyRedis(async (redis) => {
        const { deregisterProcessByKey } = await import('@scalyclaw/scalyclaw/core/registry.js');
        const processes = await getProcesses(redis, 'worker');
        // Match by port (advertised host may differ from config host)
        const target = processes.find(p => p.port === raw.gateway.port);
        if (!target) {
          console.log(`No registered worker "${opts.name}" at ${hostPort}.`);
          return;
        }
        const reachable = await isReachable(target.host, target.port);
        if (!reachable) {
          console.log(`Worker "${opts.name}" at ${target.host}:${target.port} is not reachable. Cleaning up registry.`);
          await deregisterProcessByKey(redis, target.id);
          return;
        }
        console.log(`Stopping worker "${opts.name}" at ${target.host}:${target.port}...`);
        await shutdownProcess(target);
        await deregisterProcessByKey(redis, target.id);
        console.log(`  ${target.host}:${target.port} stopped.`);
      });
    } else {
      await withAnyRedis(async (redis) => {
        const { deregisterProcessByKey } = await import('@scalyclaw/scalyclaw/core/registry.js');
        const processes = await getProcesses(redis, 'worker');
        if (processes.length === 0) {
          console.log('No registered worker processes found.');
          return;
        }
        for (const p of processes) {
          const reachable = await isReachable(p.host, p.port);
          if (!reachable) {
            console.log(`Worker at ${p.host}:${p.port} is not reachable. Cleaning up registry.`);
            await deregisterProcessByKey(redis, p.id);
            continue;
          }
          console.log(`Stopping worker at ${p.host}:${p.port}...`);
          await shutdownProcess(p);
          await deregisterProcessByKey(redis, p.id);
          console.log(`  ${p.host}:${p.port} stopped.`);
        }
      });
    }
  });

workerCmd
  .command('restart')
  .description('Restart a worker process (foreground)')
  .requiredOption('--name <name>', 'Worker instance name')
  .option('-c, --concurrency <n>', 'Tool execution concurrency override')
  .action(async (opts) => {
    // Stop the named worker first
    const configFile = workerConfigPath(opts.name);
    try {
      const raw = JSON.parse(readFileSync(configFile, 'utf-8'));
      await withAnyRedis(async (redis) => {
        const { deregisterProcessByKey } = await import('@scalyclaw/scalyclaw/core/registry.js');
        const processes = await getProcesses(redis, 'worker');
        const target = processes.find(p => p.port === raw.gateway.port);
        if (target) {
          const reachable = await isReachable(target.host, target.port);
          if (reachable) {
            console.log(`Stopping worker "${opts.name}" at ${target.host}:${target.port}...`);
            await shutdownProcess(target);
          }
          await deregisterProcessByKey(redis, target.id);
        }
      });
    } catch { /* config missing or worker not running — proceed to start */ }

    // Start with same name
    process.env.SCALYCLAW_WORKER_CONFIG = configFile;
    if (opts.concurrency) process.env.SCALYCLAW_WORKER_CONCURRENCY = opts.concurrency;
    await import('@scalyclaw/worker');
  });

workerCmd
  .command('status')
  .description('Show status of worker processes')
  .option('--name <name>', 'Worker instance name (omit to show all)')
  .action(async (opts) => {
    if (opts.name) {
      // Filter to the named worker's port
      const configFile = workerConfigPath(opts.name);
      let raw: any;
      try {
        raw = JSON.parse(readFileSync(configFile, 'utf-8'));
      } catch {
        console.error(`Worker config not found: ${configFile}`);
        process.exit(1);
      }
      await withAnyRedis(async (redis) => {
        const { deregisterProcessByKey } = await import('@scalyclaw/scalyclaw/core/registry.js');
        const processes = await getProcesses(redis, 'worker');
        const target = processes.find(p => p.port === raw.gateway.port);
        if (!target) {
          console.log(`No registered worker "${opts.name}".`);
          return;
        }
        if (!(await isReachable(target.host, target.port))) {
          await deregisterProcessByKey(redis, target.id);
          console.log(`Worker "${opts.name}" is not reachable (cleaned up).`);
          return;
        }
        console.log('');
        const icon = '\x1b[32m●\x1b[0m';
        const status = '\x1b[32mrunning\x1b[0m';
        console.log(`  ${icon} Worker (${opts.name})  ${status}  (${target.host}:${target.port})`);
        console.log(`    ID:          ${target.id}`);
        console.log(`    Host:        ${target.hostname}`);
        console.log(`    Uptime:      ${formatUptime(target.uptime)}`);
        console.log(`    Started:     ${target.startedAt}`);
        console.log(`    Version:     ${target.version}`);
        if (target.concurrency) {
          console.log(`    Concurrency: ${target.concurrency}`);
        }
        console.log('');
      });
    } else {
      await withAnyRedis(async (redis) => {
        const { deregisterProcessByKey } = await import('@scalyclaw/scalyclaw/core/registry.js');
        const processes = await getProcesses(redis, 'worker');

        const reachableProcesses: ProcessInfo[] = [];
        for (const p of processes) {
          if (await isReachable(p.host, p.port)) {
            reachableProcesses.push(p);
          } else {
            await deregisterProcessByKey(redis, p.id);
          }
        }

        if (reachableProcesses.length === 0) {
          console.log('No worker processes running.');
          return;
        }

        console.log('');
        for (const p of reachableProcesses) {
          const icon = '\x1b[32m●\x1b[0m';
          const status = '\x1b[32mrunning\x1b[0m';
          console.log(`  ${icon} Worker  ${status}  (${p.host}:${p.port})`);
          console.log(`    ID:          ${p.id}`);
          console.log(`    Host:        ${p.hostname}`);
          console.log(`    Uptime:      ${formatUptime(p.uptime)}`);
          console.log(`    Started:     ${p.startedAt}`);
          console.log(`    Version:     ${p.version}`);
          if (p.concurrency) {
            console.log(`    Concurrency: ${p.concurrency}`);
          }
          console.log('');
        }
      });
    }
  });

workerCmd
  .command('background')
  .description('Start a worker process in the background')
  .requiredOption('--name <name>', 'Worker instance name')
  .option('-c, --concurrency <n>', 'Tool execution concurrency override')
  .action((opts) => {
    const args = ['worker', 'start', '--name', opts.name];
    if (opts.concurrency) args.push('-c', opts.concurrency);

    // Resolve log dir from the worker's own config
    const configFile = workerConfigPath(opts.name);
    let logDir: string;
    try {
      const raw = JSON.parse(readFileSync(configFile, 'utf-8'));
      const resolvedHome = raw.homeDir.startsWith('~/') || raw.homeDir.startsWith('~\\')
        ? join(homedir(), raw.homeDir.slice(2))
        : raw.homeDir;
      logDir = join(resolvedHome, 'logs');
    } catch {
      logDir = join(homedir(), `.scalyclaw-worker-${opts.name}`, 'logs');
    }
    mkdirSync(logDir, { recursive: true });
    const logPath = resolve(logDir, `scalyclaw-worker-${opts.name}.log`);

    const fd = openSync(logPath, 'w', 0o600);
    const child = Bun.spawn(['bun', resolve(__dirname, 'cli.ts'), ...args], {
      stdio: [null, fd, fd],
    });
    child.unref();

    console.log(`Started worker "${opts.name}" in background (PID: ${child.pid})`);
    console.log(`Log: ${logPath}`);
  });

// ─── scalyclaw dashboard ────────────────────────────────────────────

const dashboardCmd = program
  .command('dashboard')
  .description('Manage the ScalyClaw dashboard')
  .action(() => { dashboardCmd.help(); });

dashboardCmd
  .command('setup')
  .description('Interactive setup — configure data directory and Redis connection')
  .action(async () => { await runSetup(); });

dashboardCmd
  .command('start')
  .description('Start the dashboard (foreground)')
  .option('--port <port>', 'Port', '4173')
  .option('--gateway <url>', 'Gateway URL', 'http://localhost:3000')
  .action(async (opts) => {
    const { startDashboard } = await import('./dashboard-server.js');
    await startDashboard(Number(opts.port), { gatewayUrl: opts.gateway });
  });

dashboardCmd
  .command('stop')
  .description('Stop all running dashboard processes')
  .action(async () => { await stopProcesses('dashboard'); });

dashboardCmd
  .command('restart')
  .description('Restart the dashboard (foreground)')
  .option('--port <port>', 'Port', '4173')
  .option('--gateway <url>', 'Gateway URL', 'http://localhost:3000')
  .action(async (opts) => {
    await stopProcesses('dashboard');
    const { startDashboard } = await import('./dashboard-server.js');
    await startDashboard(Number(opts.port), { gatewayUrl: opts.gateway });
  });

dashboardCmd
  .command('status')
  .description('Show status of dashboard processes')
  .action(async () => { await showStatus('dashboard'); });

dashboardCmd
  .command('background')
  .description('Start the dashboard in the background')
  .option('--port <port>', 'Port', '4173')
  .option('--gateway <url>', 'Gateway URL', 'http://localhost:3000')
  .action(async (opts) => {
    const logPath = startBackground(['dashboard', 'start', '--port', opts.port, '--gateway', opts.gateway], 'scalyclaw-dashboard.log');

    // Poll the log file for the token URL (the dashboard prints it on startup)
    const port = opts.port;
    let tokenUrl: string | null = null;
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      try {
        const content = readFileSync(logPath, 'utf-8');
        const matches = content.match(/(http:\/\/localhost:\d+\?token=\S+)/g);
        if (matches) {
          tokenUrl = matches[matches.length - 1];
          break;
        }
      } catch { /* log file not yet written */ }
      await new Promise(r => setTimeout(r, 200));
    }

    // Read gateway port for SSH tunnel hint
    let gatewayPort = '3000';
    try {
      await withRedis(async (redis) => {
        const raw = await redis.get('scalyclaw:config');
        if (raw) {
          const config = JSON.parse(raw);
          if (config.gateway?.port) gatewayPort = String(config.gateway.port);
        }
      });
    } catch { /* Redis unavailable */ }

    console.log('');
    console.log(`Dashboard: ${tokenUrl ?? `http://localhost:${port}`}`);
    if (!tokenUrl) {
      console.log(`  (token not yet available — check log: ${logPath})`);
    }
    console.log('');
    console.log('Remote access (SSH tunnel):');
    console.log(`  ssh -N -L ${port}:127.0.0.1:${port} -L ${gatewayPort}:127.0.0.1:${gatewayPort} user@your-server`);
    console.log('');
  });

program.parse();
