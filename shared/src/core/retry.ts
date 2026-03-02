import { log } from './logger.js';

export interface RetryOptions {
  /** Maximum number of attempts (including the first). Default: 3 */
  attempts?: number;
  /** Base delay in ms (doubled each retry). Default: 1000 */
  baseDelay?: number;
  /** Maximum delay cap in ms. Default: 10000 */
  maxDelay?: number;
  /** Abort signal — rejects immediately on abort. */
  signal?: AbortSignal;
  /** Label for logging. */
  label?: string;
  /** Optional predicate: return false to skip retrying for certain errors. */
  shouldRetry?: (err: unknown) => boolean;
}

/**
 * Retry an async function with exponential backoff.
 * Throws the last error if all attempts fail.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const { attempts = 3, baseDelay = 1000, maxDelay = 10_000, signal, label, shouldRetry } = opts;

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (signal?.aborted) throw new Error('Aborted');

    try {
      return await fn();
    } catch (err) {
      lastError = err;

      if (shouldRetry && !shouldRetry(err)) throw err;
      if (attempt >= attempts) break;

      const delay = Math.min(baseDelay * 2 ** (attempt - 1), maxDelay);
      log('warn', `${label ?? 'Operation'} failed (attempt ${attempt}/${attempts}), retrying in ${delay}ms`, {
        error: String(err),
      });
      await sleep(delay, signal);
    }
  }

  throw lastError;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('Aborted'));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new Error('Aborted'));
    }, { once: true });
  });
}

/**
 * Wrap a promise with a timeout. Rejects with TimeoutError if exceeded.
 */
export async function withTimeout<T>(promise: Promise<T>, ms: number, label?: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${label ?? 'Operation'} timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}
