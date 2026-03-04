import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { log } from '@scalyclaw/shared/core/logger.js';
import { PATHS } from './paths.js';
import { getConfig, saveConfig, publishConfigReload } from './config.js';

// ── Built-in Skill IDs ──────────────────────────────────────────────

export const BUILTIN_SKILL_IDS: string[] = [
  // Python (12)
  'web-search-skill',
  'web-scraper-skill',
  'pdf-reader-skill',
  'data-analyzer-skill',
  'chart-generator-skill',
  'youtube-transcript-skill',
  'text-to-speech-skill',
  'translator-skill',
  'wikipedia-skill',
  'image-processor-skill',
  'screenshot-skill',
  'ip-geolocator-skill',
  // JavaScript (12)
  'weather-skill',
  'rss-reader-skill',
  'markdown-to-pdf-skill',
  'html-to-markdown-skill',
  'json-transformer-skill',
  'email-sender-skill',
  'qr-code-skill',
  'diff-skill',
  'crypto-price-skill',
  'calendar-skill',
  'dns-lookup-skill',
  'minify-skill',
  // Rust (6)
  'hash-skill',
  'base-converter-skill',
  'jwt-decoder-skill',
  'csv-to-json-skill',
  'port-scanner-skill',
  'password-generator-skill',
  // Python — batch 2 (3)
  'ocr-skill',
  'audio-transcriber-skill',
  'file-converter-skill',
  // JavaScript — batch 2 (2)
  'http-client-skill',
  'cron-parser-skill',
  // Rust — batch 2 (3)
  'regex-tester-skill',
  'yaml-json-converter-skill',
  'text-stats-skill',
  // Bash (2)
  'git-info-skill',
  'system-monitor-skill',
  // Python — batch 3 (3)
  'pdf-merger-skill',
  'database-query-skill',
  'spell-checker-skill',
  // JavaScript — batch 3 (5)
  'stock-price-skill',
  'slack-webhook-skill',
  'timezone-converter-skill',
  'sitemap-parser-skill',
  'compress-skill',
  // Rust — batch 3 (2)
  'unit-converter-skill',
  'color-converter-skill',
  // Python — job/career (3)
  'job-search-skill',
  'resume-parser-skill',
  'job-match-skill',
  // JavaScript — job/career (1)
  'resume-formatter-skill',
  // JavaScript — general (1)
  'html-to-pdf-skill',
  // Python — job/career (1)
  'job-description-extractor-skill',
];

// ── Built-in Agent Manifest ─────────────────────────────────────────

export interface BuiltinAgentManifest {
  skills: string[];
  tools: string[];
  maxIterations: number;
}

export const BUILTIN_AGENT_MANIFEST: Record<string, BuiltinAgentManifest> = {
  'research-agent': {
    skills: ['web-search-skill', 'web-scraper-skill', 'wikipedia-skill'],
    tools: ['send_message', 'memory_store', 'memory_search', 'file_write', 'execute_skill'],
    maxIterations: 30,
  },
  'data-analyst-agent': {
    skills: ['data-analyzer-skill', 'chart-generator-skill', 'csv-to-json-skill'],
    tools: ['send_message', 'send_file', 'file_read', 'file_write', 'file_ops', 'list_directory', 'execute_skill'],
    maxIterations: 25,
  },
  'content-writer-agent': {
    skills: ['markdown-to-pdf-skill', 'chart-generator-skill', 'web-search-skill'],
    tools: ['send_message', 'send_file', 'file_write', 'file_read', 'execute_skill'],
    maxIterations: 25,
  },
  'translator-agent': {
    skills: ['translator-skill', 'web-scraper-skill'],
    tools: ['send_message', 'file_write', 'file_read', 'execute_skill'],
    maxIterations: 15,
  },
  'news-briefing-agent': {
    skills: ['web-search-skill', 'rss-reader-skill', 'web-scraper-skill'],
    tools: ['send_message', 'file_write', 'execute_skill'],
    maxIterations: 25,
  },
  'code-reviewer-agent': {
    skills: [],
    tools: ['send_message', 'file_read', 'list_directory'],
    maxIterations: 20,
  },
  'writing-assistant-agent': {
    skills: [],
    tools: ['send_message', 'file_read', 'file_write'],
    maxIterations: 15,
  },
  'devops-agent': {
    skills: [],
    tools: ['send_message', 'execute_command', 'file_read', 'file_write', 'list_directory'],
    maxIterations: 25,
  },
  'project-planner-agent': {
    skills: [],
    tools: ['send_message', 'memory_store', 'memory_search'],
    maxIterations: 20,
  },
  'debug-agent': {
    skills: [],
    tools: ['send_message', 'file_read', 'list_directory', 'execute_command', 'execute_code'],
    maxIterations: 30,
  },
  'sysadmin-agent': {
    skills: ['system-monitor-skill', 'port-scanner-skill', 'dns-lookup-skill'],
    tools: ['send_message', 'execute_command', 'execute_skill', 'file_write', 'file_read'],
    maxIterations: 25,
  },
  'api-tester-agent': {
    skills: ['http-client-skill', 'json-transformer-skill'],
    tools: ['send_message', 'execute_skill', 'file_write', 'file_read'],
    maxIterations: 20,
  },
  'document-processor-agent': {
    skills: ['pdf-reader-skill', 'ocr-skill', 'file-converter-skill', 'markdown-to-pdf-skill'],
    tools: ['send_message', 'send_file', 'execute_skill', 'file_read', 'file_write', 'list_directory'],
    maxIterations: 25,
  },
  'seo-analyst-agent': {
    skills: ['web-scraper-skill', 'web-search-skill', 'text-stats-skill'],
    tools: ['send_message', 'execute_skill', 'file_write', 'file_read'],
    maxIterations: 25,
  },
  'meeting-summarizer-agent': {
    skills: ['audio-transcriber-skill', 'translator-skill'],
    tools: ['send_message', 'send_file', 'execute_skill', 'file_write', 'file_read'],
    maxIterations: 20,
  },
  'finance-agent': {
    skills: ['stock-price-skill', 'crypto-price-skill', 'web-search-skill'],
    tools: ['send_message', 'execute_skill', 'file_write', 'file_read'],
    maxIterations: 20,
  },
  'notification-agent': {
    skills: ['slack-webhook-skill', 'email-sender-skill'],
    tools: ['send_message', 'execute_skill', 'file_read'],
    maxIterations: 10,
  },
  'pdf-toolkit-agent': {
    skills: ['pdf-reader-skill', 'pdf-merger-skill', 'ocr-skill', 'markdown-to-pdf-skill'],
    tools: ['send_message', 'send_file', 'execute_skill', 'file_read', 'file_write'],
    maxIterations: 25,
  },
  'database-analyst-agent': {
    skills: ['database-query-skill', 'data-analyzer-skill', 'chart-generator-skill'],
    tools: ['send_message', 'send_file', 'execute_skill', 'file_read', 'file_write', 'list_directory'],
    maxIterations: 25,
  },
  'site-auditor-agent': {
    skills: ['sitemap-parser-skill', 'http-client-skill', 'web-scraper-skill', 'dns-lookup-skill'],
    tools: ['send_message', 'execute_skill', 'file_write', 'file_read'],
    maxIterations: 30,
  },
  'job-search-agent': {
    skills: ['job-search-skill', 'job-description-extractor-skill', 'web-search-skill', 'web-scraper-skill'],
    tools: ['send_message', 'execute_skill', 'memory_store', 'memory_search', 'file_write', 'file_read'],
    maxIterations: 25,
  },
  'resume-coach-agent': {
    skills: ['resume-parser-skill', 'resume-formatter-skill', 'job-match-skill', 'markdown-to-pdf-skill', 'html-to-pdf-skill', 'spell-checker-skill'],
    tools: ['send_message', 'send_file', 'execute_skill', 'file_read', 'file_write', 'memory_store', 'memory_search'],
    maxIterations: 25,
  },
  'career-advisor-agent': {
    skills: ['job-search-skill', 'job-match-skill', 'resume-parser-skill', 'web-search-skill'],
    tools: ['send_message', 'send_file', 'execute_skill', 'file_read', 'file_write', 'memory_store', 'memory_search'],
    maxIterations: 25,
  },
};

export const BUILTIN_AGENT_IDS = Object.keys(BUILTIN_AGENT_MANIFEST);

// ── Registration ────────────────────────────────────────────────────

/**
 * Ensure all on-disk built-in skills/agents are registered in config.
 * New entries get `enabled: false`. Existing entries are left untouched.
 */
export async function registerBuiltins(): Promise<void> {
  const config = getConfig();
  let changed = false;

  // ── Skills ──
  const existingSkillIds = new Set(config.skills.map(s => s.id));
  for (const id of BUILTIN_SKILL_IDS) {
    if (existingSkillIds.has(id)) continue;
    if (!existsSync(join(PATHS.skills, id))) continue;
    config.skills.push({ id, enabled: false });
    changed = true;
    log('info', `Registered built-in skill: ${id} (disabled)`);
  }

  // ── Agents ──
  const existingAgentIds = new Set(config.orchestrator.agents.map(a => a.id));
  for (const [id, manifest] of Object.entries(BUILTIN_AGENT_MANIFEST)) {
    if (existingAgentIds.has(id)) continue;
    if (!existsSync(join(PATHS.agents, id))) continue;
    config.orchestrator.agents.push({
      id,
      enabled: false,
      maxIterations: manifest.maxIterations,
      models: [{ model: 'auto', weight: 1, priority: 1 }],
      skills: manifest.skills,
      tools: manifest.tools,
      mcpServers: [],
    });
    changed = true;
    log('info', `Registered built-in agent: ${id} (disabled)`);
  }

  if (changed) {
    await saveConfig(config);
    await publishConfigReload();
    log('info', 'Built-in registration complete — config updated');
  }
}
