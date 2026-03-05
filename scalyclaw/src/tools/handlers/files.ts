import { log } from '@scalyclaw/shared/core/logger.js';
import { stat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { readWorkspaceFile, writeWorkspaceFile, readWorkspaceFileLines, appendWorkspaceFile, patchWorkspaceFile, diffWorkspaceFiles, getFileInfo, copyWorkspaceFile, copyWorkspaceFolder, deleteWorkspaceFile, deleteWorkspaceFolder, renameWorkspaceFile, renameWorkspaceFolder, resolveFilePath } from '../../core/workspace.js';
import { getAllSkills, loadSkills } from '@scalyclaw/shared/skills/skill-loader.js';
import { publishSkillReload } from '../../skills/skill-store.js';
import { publishAgentReload } from '../../agents/agent-store.js';
import { invalidatePromptCache } from '../../prompt/builder.js';

/** Enforce -skill / -agent suffix on skill and agent directory paths */
export function enforcePathSuffix(filePath: string): string {
  const norm = filePath.replace(/\\/g, '/');
  const parts = norm.split('/');
  if (parts[0] === 'skills' && parts.length >= 2 && !parts[1].endsWith('-skill')) {
    parts[1] = `${parts[1]}-skill`;
    return parts.join('/');
  }
  if (parts[0] === 'agents' && parts.length >= 2 && !parts[1].endsWith('-agent')) {
    parts[1] = `${parts[1]}-agent`;
    return parts.join('/');
  }
  return filePath;
}

/** Reload skills/agents if any path touches their directories */
export async function fileReloadIfNeeded(...paths: string[]): Promise<void> {
  if (paths.some(p => p.startsWith('skills/') || p.startsWith('skills\\'))) {
    await loadSkills();
    await publishSkillReload().catch(e => log('warn', 'Skill reload failed', { error: String(e) }));
    invalidatePromptCache();
  }
  if (paths.some(p => p.startsWith('agents/') || p.startsWith('agents\\'))) {
    await publishAgentReload().catch(e => log('warn', 'Agent reload failed', { error: String(e) }));
  }
}

// ─── list_directory ───

export async function handleListDirectory(input: Record<string, unknown>): Promise<string> {
  const dirPath = (input.path as string) || '.';
  const recursive = (input.recursive as boolean) ?? false;

  log('debug', 'list_directory', { path: dirPath, recursive });

  const fullPath = resolveFilePath(dirPath);
  const entries = await readdir(fullPath, { withFileTypes: true });

  if (recursive) {
    const allEntries = await readdir(fullPath, { withFileTypes: true, recursive: true });
    const result = await Promise.all(
      allEntries
        .filter((entry) => entry.name !== 'scalyclaw.ps')
        .map(async (entry) => {
          const entryPath = join(entry.parentPath ?? entry.path, entry.name);
          const type = entry.isDirectory() ? 'directory' : 'file';
          try {
            const st = await stat(entryPath);
            return { name: entryPath.slice(fullPath.length + 1), type, size: st.size, modified: st.mtime.toISOString() };
          } catch {
            return { name: entryPath.slice(fullPath.length + 1), type };
          }
        }),
    );
    return JSON.stringify({ path: dirPath, entries: result });
  }

  const result = await Promise.all(
    entries
      .filter((entry) => entry.name !== 'scalyclaw.ps')
      .map(async (entry) => {
        const entryPath = join(fullPath, entry.name);
        const type = entry.isDirectory() ? 'directory' : 'file';
        try {
          const st = await stat(entryPath);
          return { name: entry.name, type, size: st.size, modified: st.mtime.toISOString() };
        } catch {
          return { name: entry.name, type };
        }
      }),
  );
  return JSON.stringify({ path: dirPath, entries: result });
}

// ─── Merged file tools (file_read, file_write, file_edit, file_ops) ───

export async function handleFileRead(input: Record<string, unknown>): Promise<string> {
  const path = input.path as string;
  if (!path) return JSON.stringify({ error: 'Missing required field: path' });
  if (input.startLine != null) {
    const result = await readWorkspaceFileLines(path, input.startLine as number, input.endLine as number | undefined);
    return JSON.stringify(result);
  }
  return JSON.stringify({ content: await readWorkspaceFile(path) });
}

export async function handleFileWrite(input: Record<string, unknown>): Promise<string> {
  let path = input.path as string;
  if (!path) return JSON.stringify({ error: 'Missing: path' });
  const content = input.content as string;
  if (content == null) return JSON.stringify({ error: 'Missing: content' });
  path = enforcePathSuffix(path);
  if (input.append === true) {
    await appendWorkspaceFile(path, content);
    await fileReloadIfNeeded(path);
    return JSON.stringify({ appended: true, path });
  }
  await writeWorkspaceFile(path, content);
  await fileReloadIfNeeded(path);
  return JSON.stringify({ written: true, path });
}

export async function handleFileEdit(input: Record<string, unknown>): Promise<string> {
  let path = input.path as string;
  const search = input.search as string;
  const replace = input.replace as string;
  const all = (input.all as boolean) ?? false;
  if (!path || search === undefined || replace === undefined) {
    return JSON.stringify({ error: 'Missing required fields: path, search, replace' });
  }
  path = enforcePathSuffix(path);
  const result = await patchWorkspaceFile(path, search, replace, all);
  if (!result.matched) return JSON.stringify({ error: 'Search string not found in file', path });
  await fileReloadIfNeeded(path);
  return JSON.stringify({ patched: true, count: result.count });
}

export async function handleFileOps(input: Record<string, unknown>): Promise<string> {
  const action = input.action as string;
  if (!action) return JSON.stringify({ error: 'Missing required field: action' });
  switch (action) {
    case 'copy_file': {
      const src = input.src as string;
      let dest = input.dest as string;
      if (!src || !dest) return JSON.stringify({ error: 'Missing: src, dest' });
      dest = enforcePathSuffix(dest);
      await copyWorkspaceFile(src, dest);
      await fileReloadIfNeeded(dest);
      return JSON.stringify({ copied: true });
    }
    case 'copy_folder': {
      const src = input.src as string;
      let dest = input.dest as string;
      if (!src || !dest) return JSON.stringify({ error: 'Missing: src, dest' });
      dest = enforcePathSuffix(dest);
      const r = await copyWorkspaceFolder(src, dest);
      await fileReloadIfNeeded(dest);
      return JSON.stringify({ copied: true, count: r.count });
    }
    case 'delete_file': {
      let path = input.path as string;
      if (!path) return JSON.stringify({ error: 'Missing: path' });
      path = enforcePathSuffix(path);
      await deleteWorkspaceFile(path);
      await fileReloadIfNeeded(path);
      return JSON.stringify({ deleted: true });
    }
    case 'delete_folder': {
      let path = input.path as string;
      if (!path) return JSON.stringify({ error: 'Missing: path' });
      path = enforcePathSuffix(path);
      await deleteWorkspaceFolder(path);
      await fileReloadIfNeeded(path);
      return JSON.stringify({ deleted: true });
    }
    case 'rename_file': {
      let src = input.src as string;
      let dest = input.dest as string;
      if (!src || !dest) return JSON.stringify({ error: 'Missing: src, dest' });
      src = enforcePathSuffix(src);
      dest = enforcePathSuffix(dest);
      await renameWorkspaceFile(src, dest);
      await fileReloadIfNeeded(src, dest);
      return JSON.stringify({ renamed: true });
    }
    case 'rename_folder': {
      let src = input.src as string;
      let dest = input.dest as string;
      if (!src || !dest) return JSON.stringify({ error: 'Missing: src, dest' });
      src = enforcePathSuffix(src);
      dest = enforcePathSuffix(dest);
      await renameWorkspaceFolder(src, dest);
      await fileReloadIfNeeded(src, dest);
      return JSON.stringify({ renamed: true });
    }
    case 'diff_files': {
      const pathA = input.pathA as string ?? input.src as string;
      const pathB = input.pathB as string ?? input.dest as string;
      if (!pathA || !pathB) return JSON.stringify({ error: 'Missing: pathA, pathB (or src, dest)' });
      return JSON.stringify({ diff: await diffWorkspaceFiles(pathA, pathB) });
    }
    case 'file_info': {
      const path = input.path as string;
      if (!path) return JSON.stringify({ error: 'Missing: path' });
      return JSON.stringify(await getFileInfo(path));
    }
    default:
      return JSON.stringify({ error: `Unknown action: "${action}". Valid: copy_file, copy_folder, delete_file, delete_folder, rename_file, rename_folder, diff_files, file_info` });
  }
}
