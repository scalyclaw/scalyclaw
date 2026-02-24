import type { FastifyInstance } from 'fastify';
import { readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { PATHS } from '../core/paths.js';
import { listProcesses, type ProcessInfo } from '../core/registry.js';
import { getRedis } from '../core/redis.js';

const LOG_FILES: Record<string, string> = {
  node: 'scalyclaw.log',
};

export function registerLogsRoutes(server: FastifyInstance): void {
  // GET /api/logs — list log files or tail a specific log
  server.get<{ Querystring: { file?: string; lines?: string } }>('/api/logs', async (request, reply) => {
    const processes = await listProcesses(getRedis());
    const lines = Number(request.query.lines) || 100;

    // If a specific file is requested, return its tail
    if (request.query.file) {
      // Check if the file belongs to a worker (proxy via HTTP)
      const workerProcess = processes.find(
        (p): p is ProcessInfo => p.type === 'worker' && request.query.file === `worker-${p.host}-${p.port}.log`,
      );

      if (workerProcess) {
        return proxyWorkerLogs(workerProcess, lines);
      }

      // Local file (node, dashboard)
      const filePath = join(PATHS.logs, request.query.file);
      if (!resolve(filePath).startsWith(resolve(PATHS.logs) + '/')) {
        return reply.status(400).send({ error: 'Invalid file path' });
      }

      try {
        const content = await readFile(filePath, 'utf-8');
        const allLines = content.split('\n');
        const tail = allLines.slice(-lines).join('\n');
        return { file: request.query.file, content: tail };
      } catch {
        return reply.status(404).send({ error: 'Log file not found' });
      }
    }

    // List log files — local files + remote workers
    const files: { name: string; size: number; modified: string | null; remote: boolean }[] = [];

    // Local log files for node
    for (const [, fileName] of Object.entries(LOG_FILES)) {
      const s = await stat(join(PATHS.logs, fileName)).catch(() => null);
      if (s) {
        files.push({ name: fileName, size: s.size, modified: s.mtime.toISOString(), remote: false });
      }
    }

    // Workers — listed as remote
    for (const p of processes) {
      if (p.type === 'worker') {
        files.push({
          name: `worker-${p.host}-${p.port}.log`,
          size: 0,
          modified: null,
          remote: true,
        });
      }
    }

    return { files };
  });
}

async function proxyWorkerLogs(worker: ProcessInfo, lines: number): Promise<{ file: string; content: string }> {
  const protocol = 'http';
  const url = `${protocol}://${worker.host}:${worker.port}/api/logs?lines=${lines}`;
  const headers: Record<string, string> = {};
  if (worker.authToken) {
    headers['Authorization'] = `Bearer ${worker.authToken}`;
  }

  const res = await fetch(url, { headers, signal: AbortSignal.timeout(5000) });
  if (!res.ok) {
    return { file: `worker-${worker.host}-${worker.port}.log`, content: `Error fetching worker logs: ${res.status}` };
  }
  const data = await res.json() as { file: string; content: string };
  return { file: `worker-${worker.host}-${worker.port}.log`, content: data.content };
}
