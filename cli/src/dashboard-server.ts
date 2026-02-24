import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { hostname } from 'node:os';
import pc from 'picocolors';
import WebSocket from 'ws';

const __dirname = dirname(fileURLToPath(import.meta.url));

const CONFIG_KEY = 'scalyclaw:config';

function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};
  const cookies: Record<string, string> = {};
  for (const pair of header.split(';')) {
    const [name, ...rest] = pair.trim().split('=');
    if (name) cookies[name.trim()] = rest.join('=').trim();
  }
  return cookies;
}

interface GatewayAuth {
  authType: string;
  authValue: string | null;
}

async function readGatewayAuth(gatewayRedis: { host: string; port: number; password: string | null; tls: boolean }): Promise<GatewayAuth> {
  try {
    const { createRedisClient } = await import('@scalyclaw/scalyclaw/core/redis.js');
    const redis = createRedisClient(gatewayRedis);
    await redis.connect();
    const raw = await redis.get(CONFIG_KEY);
    redis.disconnect();
    if (raw) {
      const parsed = JSON.parse(raw);
      const gw = parsed.gateway;
      if (gw) {
        return { authType: gw.authType ?? 'none', authValue: gw.authValue ?? null };
      }
    }
  } catch {
    // Redis unavailable — proceed without auth
  }
  return { authType: 'none', authValue: null };
}

interface DashboardOptions {
  gatewayUrl: string;
}

interface DashboardHandle {
  close: () => Promise<void>;
}

export async function startDashboard(port: number, options: DashboardOptions): Promise<DashboardHandle> {
  const token = `sc_${randomBytes(32).toString('base64url')}`;
  const gatewayUrl = options.gatewayUrl;

  // Read gateway auth from Redis via setup config
  let gwAuth: GatewayAuth = { authType: 'none', authValue: null };
  try {
    const { loadSetupConfig } = await import('@scalyclaw/scalyclaw/core/paths.js');
    const setupConfig = loadSetupConfig();
    gwAuth = await readGatewayAuth(setupConfig.redis);
  } catch {
    // No setup config — proceed without auth
  }

  const server = Fastify({ logger: false });
  await server.register(websocket);

  // ── Security headers ──

  server.addHook('onSend', async (_request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  });

  // ── Token validation hook ──

  server.addHook('onRequest', async (request, reply) => {
    const url = request.url.split('?')[0];

    // Skip auth for API proxy, WS, health, status
    if (url.startsWith('/api') || url === '/ws' || url === '/health' || url === '/status') return;

    // Skip favicon
    if (url === '/favicon.ico') return;

    // Check query param token
    const fullUrl = new URL(request.url, `http://${request.headers.host}`);
    const queryToken = fullUrl.searchParams.get('token');
    if (queryToken === token) {
      const isLocalhost = request.headers.host?.startsWith('localhost') || request.headers.host?.startsWith('127.0.0.1');
      const securePart = isLocalhost ? '' : '; Secure';
      reply.header('Set-Cookie', `sc_session=${token}; Path=/; HttpOnly; SameSite=Strict${securePart}`);
      return;
    }

    // Check cookie
    const cookies = parseCookies(request.headers.cookie);
    if (cookies.sc_session === token) return;

    // Reject
    reply.status(401).send({ error: 'Unauthorized' });
  });

  // ── API proxy ──

  // Dashboard shutdown — must be registered before the wildcard proxy
  server.post('/api/dashboard/shutdown', async (request, reply) => {
    const cookies = parseCookies(request.headers.cookie);
    const authHeader = request.headers.authorization ?? '';
    const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (cookies.sc_session !== token && bearerToken !== token) {
      reply.status(401).send({ error: 'Unauthorized' });
      return;
    }
    reply.send({ status: 'shutting_down' });
    setTimeout(() => process.kill(process.pid, 'SIGTERM'), 100);
  });

  server.all('/api/*', async (request, reply) => {
    await proxyHttp(request, reply, gatewayUrl, gwAuth);
  });

  server.get('/health', async (request, reply) => {
    await proxyHttp(request, reply, gatewayUrl, gwAuth);
  });

  server.get('/status', async (request, reply) => {
    await proxyHttp(request, reply, gatewayUrl, gwAuth);
  });

  // ── WebSocket proxy ──

  server.get('/ws', { websocket: true }, (socket, request) => {
    const wsCookies = parseCookies(request.headers.cookie);
    if (wsCookies.sc_session !== token) {
      socket.close(1008, 'Unauthorized');
      return;
    }

    const gwWsUrl = gatewayUrl.replace(/^http/, 'ws') + '/ws';
    const headers: Record<string, string> = {};
    if (gwAuth.authType === 'bearer' && gwAuth.authValue) {
      headers['Authorization'] = `Bearer ${gwAuth.authValue}`;
    }

    const upstream = new WebSocket(gwWsUrl, { headers });

    upstream.on('open', () => {
      // Relay client → gateway
      socket.on('message', (data: Buffer) => {
        if (upstream.readyState === WebSocket.OPEN) {
          upstream.send(data.toString());
        }
      });
    });

    // Relay gateway → client
    upstream.on('message', (data: WebSocket.Data) => {
      if (socket.readyState === 1) { // WebSocket.OPEN
        socket.send(data.toString());
      }
    });

    upstream.on('close', () => socket.close());
    upstream.on('error', () => socket.close());
    socket.on('close', () => upstream.close());
    socket.on('error', () => upstream.close());
  });

  // ── Static files ──

  const distDir = resolve(__dirname, '..', '..', 'dashboard', 'dist');

  if (existsSync(distDir)) {
    const fastifyStatic = await import('@fastify/static');
    await server.register(fastifyStatic.default, {
      root: distDir,
      prefix: '/',
      wildcard: false,
    });

    // SPA fallback
    server.setNotFoundHandler((request, reply) => {
      if (request.method === 'GET' && !request.url.startsWith('/api/')) {
        const indexPath = resolve(distDir, 'index.html');
        const html = readFileSync(indexPath, 'utf-8');
        reply.type('text/html').send(html);
      } else {
        reply.status(404).send({ error: 'Not found' });
      }
    });
  } else {
    server.setNotFoundHandler((_request, reply) => {
      reply.status(404).send({
        error: 'Dashboard not built. Run: bun run dashboard:build',
      });
    });
  }

  await server.listen({ host: '127.0.0.1', port });

  // ── Register dashboard process ──
  let dashboardRedis: import('ioredis').Redis | null = null;
  try {
    const { loadSetupConfig } = await import('@scalyclaw/scalyclaw/core/paths.js');
    const { createRedisClient } = await import('@scalyclaw/scalyclaw/core/redis.js');
    const { registerProcess, deregisterProcess, processId } = await import('@scalyclaw/scalyclaw/core/registry.js');
    const setupConfig = loadSetupConfig();
    dashboardRedis = createRedisClient(setupConfig.redis);
    await dashboardRedis.connect();

    let version = '0.1.0';
    try {
      const pkg = JSON.parse(readFileSync(resolve(__dirname, '..', '..', 'package.json'), 'utf-8'));
      version = pkg.version;
    } catch { /* fallback */ }

    await registerProcess(dashboardRedis, {
      id: processId('dashboard', '127.0.0.1', port),
      type: 'dashboard',
      host: '127.0.0.1',
      port,
      hostname: hostname(),
      startedAt: new Date().toISOString(),
      version,
      concurrency: null,
      authToken: token,
    });

    let shuttingDown = false;
    const shutdown = async () => {
      if (shuttingDown) { process.exit(1); return; }
      shuttingDown = true;
      const forceTimer = setTimeout(() => process.exit(1), 8_000);
      forceTimer.unref();
      try {
        await server.close();
      } catch { /* ignore */ }
      if (dashboardRedis) {
        try { await deregisterProcess(dashboardRedis); } catch { /* ignore */ }
        dashboardRedis.disconnect();
        dashboardRedis = null;
      }
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch {
    // Redis unavailable — dashboard still works, just not registered
  }

  const url = `http://localhost:${port}?token=${token}`;

  console.log('');
  console.log(pc.bold('ScalyClaw Dashboard'));
  console.log('');
  console.log(`  ${pc.cyan(url)}`);
  console.log('');
  console.log(pc.dim(`  Proxying API to ${gatewayUrl}`));
  console.log('');
  console.log(pc.dim(`  On a remote server, tunnel first:`));
  console.log(pc.dim(`  ssh -N -L ${port}:127.0.0.1:${port} user@your-server`));
  console.log('');

  return {
    async close() {
      if (dashboardRedis) {
        const { deregisterProcess } = await import('@scalyclaw/scalyclaw/core/registry.js');
        await deregisterProcess(dashboardRedis);
        dashboardRedis.disconnect();
        dashboardRedis = null;
      }
      return server.close();
    },
  };
}

function printTutorial(dashboardUrl: string): void {
  const dim = pc.dim;
  const cyan = pc.cyan;
  const bold = pc.bold;

  console.log('');
  console.log(bold(pc.green('ScalyClaw is ready!')));
  console.log('');
  console.log(bold('  Dashboard:'));
  console.log(`    ${cyan(dashboardUrl)}`);
  console.log('');
  console.log(bold('  Workers:'));
  console.log(`    ${cyan('bun run scalyclaw:worker start')}   ${dim('Start a worker (foreground)')}`);
  console.log('');
  console.log(bold('  Manage:'));
  console.log(`    ${cyan('bun run scalyclaw:node status')}    ${dim('Check process status')}`);
  console.log('');
}

export { printTutorial };

async function proxyHttp(
  request: { method: string; url: string; headers: Record<string, string | string[] | undefined>; body?: unknown },
  reply: { status: (code: number) => { send: (body: unknown) => void }; header: (k: string, v: string) => void; send: (body: unknown) => void },
  gatewayUrl: string,
  gwAuth: GatewayAuth,
): Promise<void> {
  const targetUrl = `${gatewayUrl}${request.url}`;
  const headers: Record<string, string> = {};

  if (gwAuth.authType === 'bearer' && gwAuth.authValue) {
    headers['Authorization'] = `Bearer ${gwAuth.authValue}`;
  } else if (gwAuth.authType === 'apikey' && gwAuth.authValue) {
    headers['Authorization'] = `Bearer ${gwAuth.authValue}`;
  }

  const hasBody = request.body && request.method !== 'GET' && request.method !== 'HEAD';
  if (hasBody) {
    headers['Content-Type'] = 'application/json';
  }

  try {
    const res = await fetch(targetUrl, {
      method: request.method,
      headers,
      body: hasBody ? JSON.stringify(request.body) : undefined,
    });

    const contentType = res.headers.get('content-type') ?? 'application/json';
    reply.header('Content-Type', contentType);

    if (contentType.includes('application/json')) {
      const body = await res.json();
      reply.status(res.status).send(body);
    } else {
      const body = await res.text();
      reply.status(res.status).send(body);
    }
  } catch (err) {
    console.error('Dashboard proxy error:', err);
    reply.status(502).send({ error: 'Gateway unreachable' });
  }
}
