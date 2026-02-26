import { readFile, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { log } from '@scalyclaw/scalyclaw/core/logger.js';
import { spawnProcess } from '@scalyclaw/scalyclaw/core/subprocess.js';
import type { SkillDefinition } from '@scalyclaw/scalyclaw/skills/skill-loader.js';
import { getWorkerExtraEnv } from './worker-env.js';

const MARKER_FILE = '.scalyclaw-installed';
const INSTALL_TIMEOUT_MS = 120_000;

/** Required CLI tool per language. */
const RUNTIME_CMDS: Record<string, string> = {
  python: 'uv',
  javascript: 'bun',
  rust: 'cargo',
};

/** Dependency files to hash per language */
const DEP_FILES: Record<string, string[]> = {
  javascript: ['package.json', 'bun.lockb', 'bun.lock'],
  python: ['pyproject.toml', 'uv.lock', 'requirements.txt'],
  rust: ['Cargo.toml', 'Cargo.lock'],
};

/** In-flight install dedup: keyed by skillDir */
const inFlight = new Map<string, Promise<void>>();

/**
 * Determine the install command for a skill.
 * Returns null if no install is needed.
 */
async function resolveInstallCommand(skill: SkillDefinition, skillDir: string): Promise<string | null> {
  // Explicit `install: none` → skip
  if (skill.install?.toLowerCase() === 'none') return null;

  // Explicit install command → use it
  if (skill.install) return skill.install;

  // Auto-detect by language
  const lang = skill.scriptLanguage;
  if (!lang) return null;

  if (lang === 'javascript') {
    if (await fileExists(join(skillDir, 'package.json'))) return 'bun install';
  } else if (lang === 'python') {
    if (await fileExists(join(skillDir, 'pyproject.toml'))) return 'uv sync';
    if (await fileExists(join(skillDir, 'requirements.txt'))) return 'uv venv && uv pip install -r requirements.txt';
  } else if (lang === 'rust') {
    if (await fileExists(join(skillDir, 'Cargo.toml'))) return 'cargo build --release';
  }

  return null;
}

/**
 * Ensure skill dependencies are installed.
 * Uses hash-based marker files and in-flight dedup.
 */
export async function ensureInstalled(skill: SkillDefinition, skillDir: string): Promise<void> {
  const command = await resolveInstallCommand(skill, skillDir);
  if (!command) return;

  // Dedup: if another call is already installing this skill, await it
  const existing = inFlight.get(skillDir);
  if (existing) {
    await existing;
    return;
  }

  // Validate required runtime is available
  if (skill.scriptLanguage) {
    const requiredCmd = RUNTIME_CMDS[skill.scriptLanguage];
    if (requiredCmd) {
      const check = await spawnProcess({
        cmd: 'which',
        args: [requiredCmd],
        cwd: skillDir,
        timeoutMs: 5_000,
        workspacePath: skillDir,
        extraEnv: getWorkerExtraEnv(),
        label: `skill-setup:${skill.id}:check`,
      });
      if (check.exitCode !== 0) {
        throw new Error(`Runtime "${requiredCmd}" not found. Install it on this worker to run ${skill.scriptLanguage} skills.`);
      }
    }
  }

  const promise = doInstall(skill, skillDir, command);
  inFlight.set(skillDir, promise);
  try {
    await promise;
  } finally {
    inFlight.delete(skillDir);
  }
}

async function doInstall(skill: SkillDefinition, skillDir: string, command: string): Promise<void> {
  // Compute hash of install command + dependency file contents
  const hash = await computeDepHash(command, skill.scriptLanguage, skillDir);

  // Check marker file
  const markerPath = join(skillDir, MARKER_FILE);
  try {
    const existing = await readFile(markerPath, 'utf-8');
    if (existing.trim() === hash) {
      log('debug', 'skill-setup: deps up-to-date, skipping install', { skillId: skill.id });
      return;
    }
  } catch {
    // No marker file — need to install
  }

  // Ensure Python skills have a venv before running install
  if (skill.scriptLanguage === 'python') {
    const venvPath = join(skillDir, '.venv');
    if (!await fileExists(venvPath)) {
      log('info', 'skill-setup: creating venv', { skillId: skill.id });
      const venvResult = await spawnProcess({
        cmd: 'uv',
        args: ['venv'],
        cwd: skillDir,
        timeoutMs: 30_000,
        workspacePath: skillDir,
        extraEnv: getWorkerExtraEnv(),
        label: `skill-setup:${skill.id}:venv`,
      });
      if (venvResult.exitCode !== 0) {
        throw new Error(`Skill "${skill.id}" venv creation failed: ${venvResult.stderr}`);
      }
    }
  }

  log('info', 'skill-setup: installing dependencies', { skillId: skill.id, command });

  const result = await spawnProcess({
    cmd: 'sh',
    args: ['-c', command],
    cwd: skillDir,
    timeoutMs: INSTALL_TIMEOUT_MS,
    workspacePath: skillDir,
    extraEnv: getWorkerExtraEnv(),
    label: `skill-setup:${skill.id}`,
  });

  if (result.exitCode !== 0) {
    log('error', 'skill-setup: install failed', { skillId: skill.id, stderr: result.stderr });
    throw new Error(`Skill "${skill.id}" dependency install failed (exit ${result.exitCode}): ${result.stderr}`);
  }

  // Write marker on success
  await writeFile(markerPath, hash, 'utf-8');
  log('info', 'skill-setup: install complete', { skillId: skill.id });
}

async function computeDepHash(command: string, language: string | null, skillDir: string): Promise<string> {
  const h = createHash('sha256');
  h.update(command);

  const files = (language && DEP_FILES[language]) ?? [];
  for (const file of files) {
    try {
      const content = await readFile(join(skillDir, file));
      h.update(`\0${file}\0`);
      h.update(content);
    } catch {
      // File doesn't exist — skip
    }
  }

  return h.digest('hex');
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** Clear in-flight install map (called on skill reload). */
export function clearInstallInFlight(): void {
  inFlight.clear();
}
