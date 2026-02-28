// ─── Redis Keys ───

export const CONFIG_KEY = 'scalyclaw:config';
export const SECRET_KEY_PREFIX = 'scalyclaw:secret:';
export const VAULT_RECOVERY_KEY = 'scalyclaw:vault:recovery-key';
export const CHANNEL_STATE_KEY_PREFIX = 'scalyclaw:channel:state:';
export const RATE_LIMIT_KEY_PREFIX = 'scalyclaw:ratelimit:';
export const RESPONSE_KEY_PREFIX = 'scalyclaw:response:';
export const PROGRESS_BUFFER_KEY_PREFIX = 'progress-buffer:';
export const ACTIVITY_KEY_PREFIX = 'scalyclaw:activity:';
export const SCHEDULED_KEY_PREFIX = 'scalyclaw:scheduled:';
export const CANCEL_FLAG_KEY = 'scalyclaw:cancel';
export const UPDATE_NOTIFY_KEY = 'scalyclaw:update:notify';
export const UPDATE_AWAITING_KEY_PREFIX = 'scalyclaw:update:awaiting:';
export const PROACTIVE_COOLDOWN_KEY_PREFIX = 'proactive:cooldown:';
export const PROACTIVE_DAILY_KEY_PREFIX = 'proactive:daily:';

// ─── Progress Pub/Sub ───

export const PROGRESS_CHANNEL_PREFIX = 'progress:';
export const PROGRESS_CHANNEL_PATTERN = 'progress:*';

// ─── TTLs (seconds) ───

/** Cancel flag TTL — short-lived, just needs to survive between guard and orchestrator. */
export const CANCEL_FLAG_TTL_S = 30;

/** Update notification persistence TTL (5 min). */
export const UPDATE_NOTIFY_TTL_S = 300;

/** Update confirmation prompt TTL (2 min). */
export const UPDATE_AWAITING_TTL_S = 120;

/** Progress response buffer TTL (5 min). */
export const RESPONSE_TTL_S = 300;

/** Vault recovery key TTL during rotation (5 min). */
export const RECOVERY_KEY_TTL_S = 300;

// ─── Timing (milliseconds) ───

/** In-memory secret cache lifetime. */
export const SECRET_CACHE_TTL_MS = 30_000;

/** Interval for draining progress buffers. */
export const PROGRESS_DRAIN_INTERVAL_MS = 60_000;

/** Delay before sending post-startup notification. */
export const STARTUP_NOTIFY_DELAY_MS = 3_000;

/** Node process shutdown timeout. */
export const SHUTDOWN_TIMEOUT_MS = 8_000;

/** Timeout for `git fetch` during /update. */
export const GIT_FETCH_TIMEOUT_MS = 15_000;

/** Vault key rotation repeatable job interval. */
export const VAULT_ROTATION_INTERVAL_MS = 600_000;

/** Typing indicator refresh interval. */
export const TYPING_INTERVAL_MS = 4_000;

/** Chat API response timeout. */
export const CHAT_RESPONSE_TIMEOUT_MS = 120_000;

/** SQLite busy timeout. */
export const SQLITE_BUSY_TIMEOUT_MS = 30_000;

// ─── Rate Limiting ───

/** Default max messages per minute per channel. */
export const DEFAULT_RATE_LIMIT_PER_MINUTE = 20;

// ─── HTTP Cache ───

/** Cache-Control max-age for served files (1 hour). */
export const FILE_CACHE_MAX_AGE_S = 3600;

// ─── Context Window ───

/** Default model context window size (tokens). */
export const DEFAULT_CONTEXT_WINDOW = 128_000;

/** Approximate characters per token (heuristic). */
export const CHARS_PER_TOKEN_RATIO = 3.5;
