import { createWriteStream, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { WriteStream } from 'node:fs';
import { LOG_META_TRUNCATE } from '../const/constants.js';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: '\x1b[90m',   // gray
  info: '\x1b[36m',    // cyan
  warn: '\x1b[33m',    // yellow
  error: '\x1b[31m',   // red
};
const RESET = '\x1b[0m';
const DIM = '\x1b[2m';

let currentLevel: LogLevel = 'debug';
let format: 'json' | 'text' = 'text';
let fileStream: WriteStream | null = null;

export function initLogger(config: { level: string; format: string }): void {
  currentLevel = (config.level as LogLevel) || 'debug';
  format = config.format === 'json' ? 'json' : 'text';
}

/** Open a log file for writing. All log output will be tee'd to this file (without ANSI colors). */
export function initLogFile(logDir: string, filename: string): string {
  mkdirSync(logDir, { recursive: true });
  const logFile = join(logDir, filename);
  fileStream = createWriteStream(logFile, { flags: 'a' });
  return logFile;
}

export function log(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
  if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[currentLevel]) return;

  const now = new Date();
  const timestamp = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}.${String(now.getMilliseconds()).padStart(3, '0')}`;

  if (format === 'json') {
    const entry = {
      timestamp: now.toISOString(),
      level,
      message,
      ...meta,
    };
    const line = JSON.stringify(entry) + '\n';
    const stream = level === 'error' ? process.stderr : process.stdout;
    stream.write(line);
    fileStream?.write(line);
  } else {
    const color = LEVEL_COLORS[level];
    const tag = level.toUpperCase().padEnd(5);
    const metaStr = meta && Object.keys(meta).length > 0
      ? ` ${DIM}${formatMeta(meta)}${RESET}`
      : '';
    const stream = level === 'error' ? process.stderr : process.stdout;
    stream.write(`${DIM}${timestamp}${RESET} ${color}${tag}${RESET} ${message}${metaStr}\n`);
    // Write to file without ANSI codes
    const plainMeta = meta && Object.keys(meta).length > 0
      ? ` ${formatMeta(meta)}`
      : '';
    fileStream?.write(`${timestamp} ${tag} ${message}${plainMeta}\n`);
  }
}

function formatMeta(meta: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(meta)) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'string') {
      // Truncate long strings
      const display = value.length > LOG_META_TRUNCATE ? value.slice(0, LOG_META_TRUNCATE) + '...' : value;
      parts.push(`${key}="${display}"`);
    } else if (typeof value === 'object') {
      parts.push(`${key}=${JSON.stringify(value)}`);
    } else {
      parts.push(`${key}=${value}`);
    }
  }
  return parts.join(' ');
}
