// ─── Redis Key Prefixes ───

export const CANCEL_KEY_PREFIX = 'scalyclaw:cancel:';
export const CHANNEL_JOBS_KEY_PREFIX = 'scalyclaw:jobs:';
export const PROCESS_KEY_PREFIX = 'scalyclaw:proc:';

// ─── Redis Pub/Sub Channels ───

export const CANCEL_SIGNAL_CHANNEL = 'scalyclaw:cancel:signal';
export const SKILLS_RELOAD_CHANNEL = 'scalyclaw:skills:reload';
export const AGENTS_RELOAD_CHANNEL = 'scalyclaw:agents:reload';
export const MCP_RELOAD_CHANNEL = 'scalyclaw:mcp:reload';
export const CONFIG_RELOAD_CHANNEL = 'scalyclaw:config:reload';

// ─── Execution ───

/** Maximum execution time for tools, skills, and code (5 hours). */
export const EXECUTION_TIMEOUT_MS = 18_000_000;

/** BullMQ lock duration — must exceed EXECUTION_TIMEOUT_MS (5h + 5min margin). */
export const LOCK_DURATION_MS = 18_300_000;

/** BullMQ stalled job detection interval. */
export const STALLED_INTERVAL_MS = 30_000;

/** Cancel-flag polling interval (fallback when pub/sub misses). */
export const CANCEL_POLL_MS = 2_000;

// ─── TTLs ───

/** Cancel flag TTL — must exceed max job duration. */
export const CANCEL_TTL_S = 3600;

/** Process registry entry TTL (refreshed by heartbeat). */
export const PROCESS_TTL_S = 30;

/** Process registry heartbeat interval. */
export const PROCESS_HEARTBEAT_MS = 15_000;

/** 7 days in seconds — used for activity keys, terminal job hashes, job failure retention. */
export const SEVEN_DAYS_S = 604_800;

// ─── BullMQ Job Cleanup ───

/** Completed job retention (seconds). */
export const JOB_COMPLETE_AGE_S = 86_400;

/** Maximum completed jobs to keep. */
export const JOB_COMPLETE_COUNT = 1000;

/** Failed job retention (seconds). */
export const JOB_FAIL_AGE_S = SEVEN_DAYS_S;

/** Default queue rate limiter max jobs per window. */
export const QUEUE_LIMITER_MAX = 10;

/** Default queue rate limiter window duration (ms). */
export const QUEUE_LIMITER_DURATION_MS = 1000;

// ─── Logging ───

/** Truncate meta string values beyond this length. */
export const LOG_META_TRUNCATE = 200;
