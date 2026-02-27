import { readFile, writeFile, mkdir, stat, cp, readdir, rm, unlink, rename } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { PATHS } from './paths.js';
import { log } from '@scalyclaw/shared/core/logger.js';

/**
 * Resolve a relative path to the correct base directory.
 * - `skills/...` → skills dir
 * - `agents/...` → agents dir
 * - `mind/...` → mind dir (reference docs)
 * - `workspace/...` → workspace dir
 * - `logs/...` → logs dir
 * - `database/...` → database dir
 * - everything else → home dir (PATHS.base)
 */
export function resolveFilePath(path: string): string {
  if (path.includes('\0')) throw new Error('Path traversal blocked: null byte');

  let base: string;
  let relative: string;

  if (path.startsWith('skills/') || path.startsWith('skills\\')) {
    base = PATHS.skills;
    relative = path.slice('skills/'.length);
  } else if (path.startsWith('agents/') || path.startsWith('agents\\')) {
    base = PATHS.agents;
    relative = path.slice('agents/'.length);
  } else if (path.startsWith('mind/') || path.startsWith('mind\\')) {
    base = PATHS.mind;
    relative = path.slice('mind/'.length);
  } else if (path.startsWith('workspace/') || path.startsWith('workspace\\')) {
    base = PATHS.workspace;
    relative = path.slice('workspace/'.length);
  } else if (path.startsWith('logs/') || path.startsWith('logs\\')) {
    base = PATHS.logs;
    relative = path.slice('logs/'.length);
  } else if (path.startsWith('database/') || path.startsWith('database\\')) {
    base = PATHS.database;
    relative = path.slice('database/'.length);
  } else {
    base = PATHS.base;
    relative = path;
  }

  const resolved = resolve(base, relative);
  const resolvedBase = resolve(base);
  if (resolved !== resolvedBase && !resolved.startsWith(resolvedBase + '/')) {
    throw new Error(`Path traversal blocked: ${path}`);
  }
  if (resolved.endsWith('/scalyclaw.ps')) {
    throw new Error('Access denied: protected file');
  }
  return resolved;
}

export async function readWorkspaceFile(path: string): Promise<string> {
  const fullPath = resolveFilePath(path);
  return readFile(fullPath, 'utf-8');
}

export async function writeWorkspaceFile(path: string, content: string): Promise<void> {
  const fullPath = resolveFilePath(path);
  await mkdir(dirname(fullPath), { recursive: true });
  await writeFile(fullPath, content, 'utf-8');
  log('debug', 'File written', { path, fullPath });
}

export async function readWorkspaceFileLines(path: string, startLine: number, endLine?: number): Promise<{ lines: string; totalLines: number }> {
  const fullPath = resolveFilePath(path);
  const content = await readFile(fullPath, 'utf-8');
  const allLines = content.split('\n');
  const totalLines = allLines.length;

  const start = Math.max(1, startLine) - 1; // 1-indexed → 0-indexed
  const end = endLine ? Math.min(endLine, totalLines) : totalLines;
  const selected = allLines.slice(start, end);

  // Return with line numbers
  const numbered = selected.map((line, i) => `${start + i + 1}\t${line}`).join('\n');
  return { lines: numbered, totalLines };
}

export async function appendWorkspaceFile(path: string, content: string): Promise<void> {
  const fullPath = resolveFilePath(path);
  await mkdir(dirname(fullPath), { recursive: true });

  let existing = '';
  try {
    existing = await readFile(fullPath, 'utf-8');
  } catch {
    // File doesn't exist yet — will create
  }

  const separator = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
  await writeFile(fullPath, existing + separator + content, 'utf-8');
  log('debug', 'File appended', { path, fullPath, appendedLength: content.length });
}

export async function patchWorkspaceFile(path: string, search: string, replace: string, all: boolean): Promise<{ matched: boolean; count: number }> {
  const fullPath = resolveFilePath(path);
  const content = await readFile(fullPath, 'utf-8');

  if (!content.includes(search)) {
    return { matched: false, count: 0 };
  }

  let patched: string;
  let count: number;

  if (all) {
    count = content.split(search).length - 1;
    patched = content.replaceAll(search, replace);
  } else {
    count = 1;
    patched = content.replace(search, replace);
  }

  await writeFile(fullPath, patched, 'utf-8');
  log('debug', 'File patched', { path, fullPath, count });
  return { matched: true, count };
}

export async function diffWorkspaceFiles(pathA: string, pathB: string): Promise<string> {
  const [contentA, contentB] = await Promise.all([
    readFile(resolveFilePath(pathA), 'utf-8'),
    readFile(resolveFilePath(pathB), 'utf-8'),
  ]);

  const linesA = contentA.split('\n');
  const linesB = contentB.split('\n');

  // Myers-style LCS diff
  const hunks: string[] = [];
  const n = linesA.length;
  const m = linesB.length;

  // Build LCS table
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));

  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (linesA[i] === linesB[j]) {
        lcs[i][j] = lcs[i + 1][j + 1] + 1;
      } else {
        lcs[i][j] = Math.max(lcs[i + 1][j], lcs[i][j + 1]);
      }
    }
  }

  // Walk the LCS table to produce unified diff lines
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && linesA[i] === linesB[j]) {
      hunks.push(` ${linesA[i]}`);
      i++;
      j++;
    } else if (j < m && (i >= n || lcs[i][j + 1] >= lcs[i + 1][j])) {
      hunks.push(`+${linesB[j]}`);
      j++;
    } else {
      hunks.push(`-${linesA[i]}`);
      i++;
    }
  }

  // Compact: only show hunks with changes (context of 3 lines around each change)
  const CONTEXT = 3;
  const changed = new Set<number>();
  for (let k = 0; k < hunks.length; k++) {
    if (hunks[k][0] === '+' || hunks[k][0] === '-') {
      for (let c = Math.max(0, k - CONTEXT); c <= Math.min(hunks.length - 1, k + CONTEXT); c++) {
        changed.add(c);
      }
    }
  }

  if (changed.size === 0) {
    return 'Files are identical.';
  }

  const output: string[] = [`--- ${pathA}`, `+++ ${pathB}`];
  let lastIdx = -2;
  for (const k of [...changed].sort((a, b) => a - b)) {
    if (k > lastIdx + 1) {
      output.push('...');
    }
    output.push(hunks[k]);
    lastIdx = k;
  }

  return output.join('\n');
}

export async function getFileInfo(path: string): Promise<{ size: number; lines: number; modified: string }> {
  const fullPath = resolveFilePath(path);
  const [st, content] = await Promise.all([
    stat(fullPath),
    readFile(fullPath, 'utf-8'),
  ]);
  return {
    size: st.size,
    lines: content.split('\n').length,
    modified: st.mtime.toISOString(),
  };
}

export async function copyWorkspaceFile(src: string, dest: string): Promise<void> {
  const srcPath = resolveFilePath(src);
  const destPath = resolveFilePath(dest);
  await mkdir(dirname(destPath), { recursive: true });
  await cp(srcPath, destPath);
  log('debug', 'File copied', { src, dest });
}

export async function copyWorkspaceFolder(src: string, dest: string): Promise<{ count: number }> {
  const srcPath = resolveFilePath(src);
  const destPath = resolveFilePath(dest);

  // Verify source is a directory
  const st = await stat(srcPath);
  if (!st.isDirectory()) {
    throw new Error(`Source is not a directory: ${src}`);
  }

  await cp(srcPath, destPath, { recursive: true });

  // Count copied entries
  const entries = await readdir(destPath, { recursive: true });
  const count = entries.length;

  log('debug', 'Folder copied', { src, dest, count });
  return { count };
}

export async function deleteWorkspaceFile(path: string): Promise<void> {
  const fullPath = resolveFilePath(path);
  await unlink(fullPath);
  log('debug', 'File deleted', { path, fullPath });
}

export async function deleteWorkspaceFolder(path: string): Promise<void> {
  const fullPath = resolveFilePath(path);
  const st = await stat(fullPath);
  if (!st.isDirectory()) {
    throw new Error(`Not a directory: ${path}`);
  }
  await rm(fullPath, { recursive: true, force: true });
  log('debug', 'Folder deleted', { path, fullPath });
}

export async function renameWorkspaceFile(src: string, dest: string): Promise<void> {
  const srcPath = resolveFilePath(src);
  const destPath = resolveFilePath(dest);
  await mkdir(dirname(destPath), { recursive: true });
  await rename(srcPath, destPath);
  log('debug', 'File renamed', { src, dest });
}

export async function renameWorkspaceFolder(src: string, dest: string): Promise<void> {
  const srcPath = resolveFilePath(src);
  const destPath = resolveFilePath(dest);
  const st = await stat(srcPath);
  if (!st.isDirectory()) {
    throw new Error(`Not a directory: ${src}`);
  }
  await mkdir(dirname(destPath), { recursive: true });
  await rename(srcPath, destPath);
  log('debug', 'Folder renamed', { src, dest });
}
