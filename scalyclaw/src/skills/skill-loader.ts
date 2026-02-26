import { readFile, readdir, writeFile, rm, mkdir } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { unzipSync } from 'fflate';
import { log } from '../core/logger.js';
import { PATHS } from '../core/paths.js';

export interface SkillDefinition {
  id: string;
  name: string;
  description: string;
  scriptPath: string | null;
  scriptLanguage: string | null;
  install: string | null;
  timeout: number | null;
  markdown: string;
}


const loadedSkills = new Map<string, SkillDefinition>();

export async function loadSkills(): Promise<Map<string, SkillDefinition>> {
  loadedSkills.clear();

  // Load user-created skills from the skills directory
  try {
    const entries = await readdir(PATHS.skills, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        await loadSkillFromDir(join(PATHS.skills, entry.name), entry.name);
      }
    }
  } catch {
    log('debug', 'No user skills directory found');
  }

  log('info', `Loaded ${loadedSkills.size} skills`);
  return loadedSkills;
}

async function loadSkillFromDir(dirPath: string, skillId: string): Promise<void> {
  try {
    const readmePath = join(dirPath, 'SKILL.md');
    const markdown = await readFile(readmePath, 'utf-8');

    // Parse YAML frontmatter (handles \r\n and \n)
    let name = skillId;
    let description = '';
    let script: string | null = null;
    let language: string | null = null;
    let install: string | null = null;
    let timeout: number | null = null;

    // Normalize line endings before parsing
    const normalized = markdown.replace(/\r\n/g, '\n');
    const frontmatterMatch = normalized.match(/^---\n([\s\S]*?)\n---/);
    if (frontmatterMatch) {
      const fm = frontmatterMatch[1];
      // Extract value: strip inline YAML comments (# ...) and trim
      const extractValue = (line: string): string => line.replace(/#.*$/, '').trim();
      const nameMatch = fm.match(/^name:\s*(.+)/m);
      const descMatch = fm.match(/^description:\s*(.+)/m);
      const scriptMatch = fm.match(/^script:\s*(.+)/m);
      const langMatch = fm.match(/^language:\s*(.+)/m);
      const installMatch = fm.match(/^install:\s*(.+)/m);
      const timeoutMatch = fm.match(/^timeout:\s*(.+)/m);
      if (nameMatch) name = extractValue(nameMatch[1]);
      if (descMatch) description = extractValue(descMatch[1]);
      if (scriptMatch) script = extractValue(scriptMatch[1]);
      if (langMatch) language = extractValue(langMatch[1]);
      if (installMatch) install = extractValue(installMatch[1]);
      if (timeoutMatch) {
        const parsed = parseInt(extractValue(timeoutMatch[1]), 10);
        if (!isNaN(parsed) && parsed > 0) timeout = parsed * 1000; // frontmatter is in seconds, convert to ms
      }
    }

    log('debug', `Parsed skill frontmatter: ${skillId}`, { name, script, language, install });

    loadedSkills.set(skillId, {
      id: skillId,
      name,
      description,
      scriptPath: script ? join(dirPath, script) : null,
      scriptLanguage: language ?? null,
      install,
      timeout,
      markdown,
    });

    log('info', `Loaded skill: ${skillId}`, { name, script, language });
  } catch (err) {
    log('warn', `Failed to load skill: ${skillId}`, { error: String(err) });
  }
}

export function getSkill(skillId: string): SkillDefinition | undefined {
  return loadedSkills.get(skillId);
}

export function getAllSkills(): SkillDefinition[] {
  return [...loadedSkills.values()];
}

/** Dirs to preserve across zip re-extractions (runtime artifacts + install marker). */
const PRESERVE = new Set(['.venv', 'node_modules', 'target', '__pycache__', '.scalyclaw-installed']);

/** Remove skill source files while keeping runtime artifacts intact. */
async function cleanSkillDirForExtract(skillDir: string): Promise<void> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await readdir(skillDir, { withFileTypes: true });
  } catch {
    // Dir doesn't exist yet — nothing to clean
    await mkdir(skillDir, { recursive: true });
    return;
  }
  for (const entry of entries) {
    if (PRESERVE.has(entry.name)) continue;
    await rm(join(skillDir, entry.name), { recursive: true, force: true });
  }
}

export async function createSkillFromZip(skillId: string, zipBuffer: Uint8Array): Promise<SkillDefinition> {
  const files = unzipSync(zipBuffer);
  const skillDir = join(PATHS.skills, skillId);
  await cleanSkillDirForExtract(skillDir);
  await mkdir(skillDir, { recursive: true });

  const resolvedSkillDir = resolve(skillDir);
  for (const [path, data] of Object.entries(files)) {
    // Skip directories (fflate marks them with trailing slash and empty data)
    if (path.endsWith('/')) continue;
    const fullPath = join(skillDir, path);
    // Prevent zip slip: reject entries that escape the skill directory
    if (!resolve(fullPath).startsWith(resolvedSkillDir + '/')) continue;
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, data);
  }

  // Verify SKILL.md exists
  try {
    await readFile(join(skillDir, 'SKILL.md'), 'utf-8');
  } catch {
    await rm(skillDir, { recursive: true, force: true });
    throw new Error(`Zip for skill "${skillId}" does not contain a SKILL.md file`);
  }

  await loadSkillFromDir(skillDir, skillId);
  const skill = loadedSkills.get(skillId);
  if (!skill) throw new Error(`Failed to load skill "${skillId}" after extraction`);
  return skill;
}

export async function deleteSkill(skillId: string): Promise<void> {
  const skillDir = join(PATHS.skills, skillId);
  await rm(skillDir, { recursive: true, force: true });
  loadedSkills.delete(skillId);
  log('info', `Deleted skill: ${skillId}`);
}
