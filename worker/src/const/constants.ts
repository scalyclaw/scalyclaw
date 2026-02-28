// ─── Timeouts ───

/** Timeout for fetching skills or workspace files from node API. */
export const FETCH_TIMEOUT_MS = 15_000;

/** Timeout for skill dependency installation. */
export const INSTALL_TIMEOUT_MS = 120_000;

/** Timeout for `which` runtime check. */
export const WHICH_TIMEOUT_MS = 5_000;

/** Timeout for Python venv creation. */
export const VENV_TIMEOUT_MS = 30_000;

/** Grace period before SIGKILL after SIGTERM. */
export const FORCE_KILL_TIMEOUT_MS = 3_000;

/** Worker process shutdown timeout. */
export const SHUTDOWN_TIMEOUT_MS = 8_000;

/** Delay before sending SIGTERM on /api/shutdown. */
export const SHUTDOWN_DELAY_MS = 100;

// ─── File System ───

/** Marker file written after successful dependency install. */
export const INSTALL_MARKER_FILE = '.scalyclaw-installed';

/** Worker log file name. */
export const WORKER_LOG_FILE = 'worker.log';

/** Subdirectory under workspace for temporary execution files. */
export const EXEC_DIR = '_exec';

// ─── Output Limits ───

/** Maximum stdout/stderr buffer size per subprocess (10 MB). */
export const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;

// ─── Internal Job Data Field Keys ───

export const JOB_FIELD_SECRETS = '_secrets';
export const JOB_FIELD_DENIED_COMMANDS = '_deniedCommands';
export const JOB_FIELD_WORKER_FILES = '_workerFiles';
export const JOB_FIELD_WORKER_PROCESS_ID = '_workerProcessId';
export const JOB_FIELD_WORKSPACE_FILES = '_workspaceFiles';
