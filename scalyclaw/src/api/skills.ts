import type { FastifyInstance } from 'fastify';
import { getAllSkills, getSkill, loadSkills, createSkillFromZip, deleteSkill } from '../skills/skill-loader.js';
import { publishSkillReload } from '../skills/skill-store.js';
import { getConfig, saveConfig } from '../core/config.js';
import { PATHS } from '../core/paths.js';
import { validateId } from '../core/validation.js';
import { join } from 'node:path';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { runSkillGuard } from '../guards/guard.js';
import { enqueueJob, getQueue, getQueueEvents } from '../queue/queue.js';
import { log } from '../core/logger.js';

export function registerSkillsRoutes(server: FastifyInstance): void {
  // GET /api/skills — list all loaded skills
  server.get('/api/skills', async () => {
    const skills = getAllSkills();
    const config = getConfig();
    const enabledMap = new Map(config.skills.map(s => [s.id, s.enabled]));
    return {
      skills: skills.map(s => ({
        id: s.id,
        name: s.name,
        description: s.description,
        hasScript: !!s.scriptPath,
        language: s.scriptLanguage,
        enabled: enabledMap.get(s.id) ?? true,
      })),
    };
  });

  // PATCH /api/skills/:id — toggle enabled
  server.patch<{ Params: { id: string }; Body: { enabled: boolean } }>(
    '/api/skills/:id',
    async (request, reply) => {
      const { id } = request.params;
      const skill = getSkill(id);
      if (!skill) return reply.status(404).send({ error: 'Skill not found' });

      const { enabled } = request.body ?? {};
      if (typeof enabled !== 'boolean') return reply.status(400).send({ error: 'enabled (boolean) is required' });
      if (id === 'skill-creator-agent' && !enabled) return reply.status(400).send({ error: 'Cannot disable the built-in skill-creator-agent' });

      const config = getConfig();
      const entry = config.skills.find(s => s.id === id);
      if (entry) {
        entry.enabled = enabled;
      } else {
        config.skills.push({ id, enabled });
      }
      await saveConfig(config);
      await publishSkillReload().catch(() => {});
      return { success: true, enabled };
    },
  );

  // POST /api/skills/upload — upload a skill zip
  server.post('/api/skills/upload', async (request, reply) => {
    const data = await request.file();
    if (!data) return reply.status(400).send({ error: 'No file uploaded' });

    const idField = data.fields.id;
    let id = idField && 'value' in idField ? String(idField.value).trim() : '';
    if (!id) return reply.status(400).send({ error: 'Missing skill id field' });
    // Enforce -skill suffix
    if (!id.endsWith('-skill')) id = `${id}-skill`;
    if (!validateId(id)) return reply.status(400).send({ error: 'Invalid skill id' });

    const buffer = await data.toBuffer();

    try {
      const skill = await createSkillFromZip(id, new Uint8Array(buffer));

      // Run skill guard on uploaded content
      let scriptContents = '';
      try {
        const skillDir = join(PATHS.skills, id);
        const entries = await readdir(skillDir);
        for (const entry of entries) {
          if (entry === 'SKILL.md') continue;
          try {
            const content = await readFile(join(skillDir, entry), 'utf-8');
            scriptContents += `\n--- ${entry} ---\n${content}`;
          } catch { /* skip binary files */ }
        }
      } catch { /* skip if dir read fails */ }

      const guardResult = await runSkillGuard(id, skill.markdown, scriptContents || undefined);
      if (!guardResult.passed) {
        await deleteSkill(id);
        return reply.status(403).send({ error: `Skill blocked by security guard: ${guardResult.reason}` });
      }

      // Register in config
      const config = getConfig();
      if (!config.skills.some(s => s.id === id)) {
        config.skills.push({ id, enabled: true });
        await saveConfig(config);
      }

      await publishSkillReload().catch(() => {});
      return { success: true, skill: { id: skill.id, name: skill.name, description: skill.description } };
    } catch (err) {
      return reply.status(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // POST /api/skills/:id/invoke — invoke a skill's script (via worker)
  server.post<{ Params: { id: string }; Body: { input?: string; timeoutMs?: number } }>(
    '/api/skills/:id/invoke',
    async (request, reply) => {
      const skill = getSkill(request.params.id);
      if (!skill) return reply.status(404).send({ error: 'Skill not found' });
      if (!skill.scriptPath || !skill.scriptLanguage) {
        return reply.status(400).send({ error: 'Skill has no executable script' });
      }

      const { input, timeoutMs } = request.body ?? {};
      const timeout = timeoutMs ?? 300_000;

      try {
        const jobId = await enqueueJob({
          name: 'skill-execution',
          data: {
            skillId: skill.id,
            input: input ?? '',
            timeoutMs: timeout,
          },
          opts: { attempts: 1 },
        });

        const job = await getQueue('tools').getJob(jobId);
        if (!job) {
          return reply.status(500).send({ error: 'Failed to enqueue skill execution job' });
        }

        const events = getQueueEvents('tools');
        const raw = await job.waitUntilFinished(events, timeout + 5_000) as string;
        return JSON.parse(raw);
      } catch (err) {
        log('error', 'Skill invocation via worker failed', { skillId: skill.id, error: String(err) });
        return reply.status(500).send({ error: `Skill execution failed: ${String(err)}` });
      }
    },
  );

  // GET /api/skills/:id/readme — read SKILL.md content
  server.get<{ Params: { id: string } }>(
    '/api/skills/:id/readme',
    async (request, reply) => {
      const skill = getSkill(request.params.id);
      if (!skill) return reply.status(404).send({ error: 'Skill not found' });
      return { id: skill.id, content: skill.markdown };
    },
  );

  // PUT /api/skills/:id/readme — save SKILL.md content
  server.put<{ Params: { id: string }; Body: { content: string } }>(
    '/api/skills/:id/readme',
    async (request, reply) => {
      const { id } = request.params;
      const skill = getSkill(id);
      if (!skill) return reply.status(404).send({ error: 'Skill not found' });

      const filePath = join(PATHS.skills, id, 'SKILL.md');
      try {
        await readFile(filePath); // verify the file exists on disk
      } catch {
        return reply.status(400).send({ error: 'Cannot edit built-in skills' });
      }

      // Run skill guard on new content before writing
      const guardResult = await runSkillGuard(id, request.body.content);
      if (!guardResult.passed) {
        return reply.status(403).send({ error: `Skill edit blocked by security guard: ${guardResult.reason}` });
      }

      await writeFile(filePath, request.body.content, 'utf-8');
      await loadSkills();
      await publishSkillReload().catch(() => {});
      return { ok: true };
    },
  );

  // GET /api/skills/:id/zip — download skill as zip
  server.get<{ Params: { id: string } }>(
    '/api/skills/:id/zip',
    async (request, reply) => {
      const skill = getSkill(request.params.id);
      if (!skill) return reply.status(404).send({ error: 'Skill not found' });

      const skillDir = join(PATHS.skills, request.params.id);
      const { zipSync } = await import('fflate');
      const entries: Record<string, Uint8Array> = {};

      const SKIP_DIRS = new Set(['node_modules', '.venv', '__pycache__', 'target']);
      const SKIP_FILES = new Set(['.scalyclaw-installed']);

      async function addDir(dir: string, prefix: string): Promise<void> {
        const items = await readdir(dir, { withFileTypes: true });
        for (const item of items) {
          if (item.isDirectory() && SKIP_DIRS.has(item.name)) continue;
          if (!item.isDirectory() && SKIP_FILES.has(item.name)) continue;
          const fullPath = join(dir, item.name);
          const entryPath = prefix ? `${prefix}/${item.name}` : item.name;
          if (item.isDirectory()) {
            await addDir(fullPath, entryPath);
          } else {
            const content = await readFile(fullPath);
            entries[entryPath] = new Uint8Array(content);
          }
        }
      }

      try {
        await addDir(skillDir, '');
      } catch {
        return reply.status(404).send({ error: 'Skill directory not found' });
      }

      const zipBuffer = zipSync(entries);
      reply.header('Content-Type', 'application/zip');
      reply.header('Content-Disposition', `attachment; filename="${request.params.id}.zip"`);
      return reply.send(Buffer.from(zipBuffer));
    },
  );

  // DELETE /api/skills/:id — delete a skill
  server.delete<{ Params: { id: string } }>(
    '/api/skills/:id',
    async (request, reply) => {
      const { id } = request.params;
      const skill = getSkill(id);
      if (!skill) return reply.status(404).send({ error: 'Skill not found' });

      await deleteSkill(id);

      // Remove from config
      const config = getConfig();
      config.skills = config.skills.filter(s => s.id !== id);
      await saveConfig(config);

      await publishSkillReload().catch(() => {});
      return { success: true };
    },
  );
}
