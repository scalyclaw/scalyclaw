const BASE = import.meta.env.VITE_API_URL ?? '';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

function getToken(): string | null {
  return localStorage.getItem('scalyclaw_token');
}

export function setToken(token: string) {
  localStorage.setItem('scalyclaw_token', token);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { ...(init?.headers as Record<string, string>) };
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (init?.body && typeof init.body === 'string') {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(`${BASE}${path}`, { ...init, headers });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    let message = `HTTP ${res.status}`;
    try {
      const json = JSON.parse(body);
      message = json.error ?? json.message ?? message;
    } catch {
      if (body) message = body;
    }
    if (res.status === 401) {
      window.dispatchEvent(new CustomEvent('api-401', { detail: 401 }));
    }
    throw new ApiError(res.status, message);
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

// System
export const getStatus = () => request<Record<string, unknown>>('/status');

// Chat
export const getMessages = () => request<{ messages: Array<{ role: string; content: string }> }>('/api/messages');

// Config
export const getConfig = () => request<Record<string, unknown>>('/api/config');
export const updateConfig = (config: Record<string, unknown>) =>
  request<void>('/api/config', { method: 'PUT', body: JSON.stringify(config) });

// Models
export const getModels = () => request<{ providers: string[]; models: Array<Record<string, unknown>>; embeddingModels: Array<Record<string, unknown>> }>('/api/models');
export const testModel = (id: string) =>
  request<{ model: string; provider: string; ok: boolean; error?: string }>(`/api/models/test`, { method: 'POST', body: JSON.stringify({ model: id }) });
export const toggleModel = (id: string, enabled: boolean) =>
  request<{ enabled: boolean }>(`/api/models/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ enabled }) });

// Agents
export const getAgents = () => request<{ agents: Array<Record<string, unknown>> }>('/api/agents');
export const createAgent = (agent: Record<string, unknown>) =>
  request<void>('/api/agents', { method: 'POST', body: JSON.stringify(agent) });
export const updateAgent = (id: string, agent: Record<string, unknown>) =>
  request<void>(`/api/agents/${id}`, { method: 'PUT', body: JSON.stringify(agent) });
export const deleteAgent = (id: string) =>
  request<void>(`/api/agents/${id}`, { method: 'DELETE' });
export const toggleAgent = (id: string, enabled: boolean) =>
  request<{ enabled: boolean }>(`/api/agents/${id}`, { method: 'PATCH', body: JSON.stringify({ enabled }) });
export const getAgentEligibleTools = () =>
  request<{ tools: string[] }>('/api/agents/eligible-tools');

// Skills
export const getSkills = () => request<{ skills: Array<Record<string, unknown>> }>('/api/skills');
export const invokeSkill = (id: string, input: string) =>
  request<{ result: string }>(`/api/skills/${id}/invoke`, { method: 'POST', body: JSON.stringify({ input }) });
export const deleteSkill = (id: string) =>
  request<void>(`/api/skills/${id}`, { method: 'DELETE' });
export const getSkillReadme = (id: string) =>
  request<{ id: string; content: string }>(`/api/skills/${encodeURIComponent(id)}/readme`);
export const updateSkillReadme = (id: string, content: string) =>
  request<{ ok: boolean }>(`/api/skills/${encodeURIComponent(id)}/readme`, { method: 'PUT', body: JSON.stringify({ content }) });
export const toggleSkill = (id: string, enabled: boolean) =>
  request<{ enabled: boolean }>(`/api/skills/${id}`, { method: 'PATCH', body: JSON.stringify({ enabled }) });
export async function uploadSkillZip(id: string, file: File): Promise<{ success: boolean; skill: Record<string, unknown> }> {
  const form = new FormData();
  form.append('id', id);
  form.append('file', file);
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}/api/skills/upload`, { method: 'POST', headers, body: form });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    let message = `HTTP ${res.status}`;
    try { const json = JSON.parse(body); message = json.error ?? message; } catch {}
    throw new ApiError(res.status, message);
  }
  return res.json();
}
export async function downloadSkillZip(id: string): Promise<void> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}/api/skills/${encodeURIComponent(id)}/zip`, { headers });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    let message = `HTTP ${res.status}`;
    try { const json = JSON.parse(body); message = json.error ?? message; } catch {}
    throw new ApiError(res.status, message);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${id}.zip`;
  a.click();
  URL.revokeObjectURL(url);
}

// Memory
export const listMemory = () =>
  request<{ results: Array<Record<string, unknown>> }>('/api/memory');
export const searchMemory = (q: string, tags?: string[]) => {
  let url = `/api/memory/search?q=${encodeURIComponent(q)}`;
  if (tags?.length) url += `&tags=${encodeURIComponent(tags.join(','))}`;
  return request<{ results: Array<Record<string, unknown>> }>(url);
};
export const storeMemory = (data: Record<string, unknown>) =>
  request<{ id: string }>('/api/memory', { method: 'POST', body: JSON.stringify(data) });
export const deleteMemory = (id: string) =>
  request<void>(`/api/memory/${id}`, { method: 'DELETE' });

// Vault
export const getSecrets = () => request<{ secrets: string[] }>('/api/vault');
export const getSecret = (name: string) => request<{ name: string; value: string }>(`/api/vault/${name}`);
export const setSecret = (name: string, value: string) =>
  request<void>('/api/vault', { method: 'POST', body: JSON.stringify({ name, value }) });
export const deleteSecret = (name: string) =>
  request<void>(`/api/vault/${name}`, { method: 'DELETE' });

// Jobs
export const getJobQueues = () =>
  request<{ queues: string[] }>('/api/jobs/queues');
export const getJobs = (status: string, queue?: string) => {
  let url = `/api/jobs?status=${status}`;
  if (queue) url += `&queue=${encodeURIComponent(queue)}`;
  return request<{ jobs: Array<Record<string, unknown>> }>(url);
};
export const getJobCounts = (queue?: string) => {
  let url = '/api/jobs/counts';
  if (queue) url += `?queue=${encodeURIComponent(queue)}`;
  return request<{ counts: Record<string, Record<string, number>> }>(url);
};
export const deleteJob = (queue: string, id: string) =>
  request<{ removed: boolean }>(`/api/jobs/${encodeURIComponent(queue)}/${encodeURIComponent(id)}`, { method: 'DELETE' });
export const retryJob = (queue: string, id: string) =>
  request<{ retried: boolean }>(`/api/jobs/${encodeURIComponent(queue)}/${encodeURIComponent(id)}/retry`, { method: 'POST' });
export const failJob = (queue: string, id: string) =>
  request<{ failed: boolean }>(`/api/jobs/${encodeURIComponent(queue)}/${encodeURIComponent(id)}/fail`, { method: 'POST' });
export const completeJob = (queue: string, id: string) =>
  request<{ completed: boolean }>(`/api/jobs/${encodeURIComponent(queue)}/${encodeURIComponent(id)}/complete`, { method: 'POST' });
// Workers
export const getWorkers = () => request<{ workers: Array<Record<string, unknown>> }>('/api/workers');

// Scheduler
export const getSchedulerJobs = () => {
  return request<{ jobs: Array<Record<string, unknown>> }>('/api/scheduler');
};
export const createReminder = (data: Record<string, unknown>) =>
  request<void>('/api/scheduler/reminder', { method: 'POST', body: JSON.stringify(data) });
export const createRecurrentReminder = (data: Record<string, unknown>) =>
  request<void>('/api/scheduler/recurrent-reminder', { method: 'POST', body: JSON.stringify(data) });
export const createTask = (data: Record<string, unknown>) =>
  request<void>('/api/scheduler/task', { method: 'POST', body: JSON.stringify(data) });
export const createRecurrentTask = (data: Record<string, unknown>) =>
  request<void>('/api/scheduler/recurrent-task', { method: 'POST', body: JSON.stringify(data) });
export const cancelSchedulerJob = (id: string) =>
  request<void>(`/api/scheduler/${id}`, { method: 'DELETE' });
export const completeSchedulerJob = (id: string) =>
  request<{ completed: boolean }>(`/api/scheduler/${encodeURIComponent(id)}/complete`, { method: 'POST' });
export const purgeSchedulerJob = (id: string) =>
  request<{ deleted: boolean }>(`/api/scheduler/${encodeURIComponent(id)}/purge`, { method: 'DELETE' });

// Logs
export const getLogs = () => request<{ files: Array<{ name: string; size: number; modified: string }> }>('/api/logs');
export const getLogContent = (file: string, lines = 200) =>
  request<{ content: string }>(`/api/logs?file=${encodeURIComponent(file)}&lines=${lines}`);

// Mind
export const getMindFiles = () => request<{ files: string[] }>('/api/mind');
export const getMindFileContent = (name: string) =>
  request<{ content: string }>(`/api/mind/${encodeURIComponent(name)}`);
export const updateMindFile = (name: string, content: string) =>
  request<{ ok: boolean }>(`/api/mind/${encodeURIComponent(name)}`, { method: 'PUT', body: JSON.stringify({ content }) });

// Channels
export const getChannels = () => request<{ channels: Array<Record<string, unknown>> }>('/api/channels');
export const toggleChannel = (id: string, enabled: boolean) =>
  request<{ enabled: boolean }>(`/api/channels/${id}`, { method: 'PATCH', body: JSON.stringify({ enabled }) });

// MCP
export const getMcpServers = () => request<{ servers: Array<Record<string, unknown>> }>('/api/mcp');
export const createMcpServer = (data: Record<string, unknown>) =>
  request<void>('/api/mcp', { method: 'POST', body: JSON.stringify(data) });
export const updateMcpServer = (id: string, data: Record<string, unknown>) =>
  request<void>(`/api/mcp/${id}`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteMcpServer = (id: string) =>
  request<void>(`/api/mcp/${id}`, { method: 'DELETE' });
export const reconnectMcpServer = (id: string) =>
  request<void>(`/api/mcp/${id}/reconnect`, { method: 'POST' });
export const toggleMcpServer = (id: string, enabled: boolean) =>
  request<{ enabled: boolean }>(`/api/mcp/${id}`, { method: 'PATCH', body: JSON.stringify({ enabled }) });

// Usage
export const getUsage = (from?: string, to?: string) => {
  let url = '/api/usage';
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  const qs = params.toString();
  if (qs) url += `?${qs}`;
  return request<{
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCost: number;
    byModel: Array<{ model: string; provider: string; inputTokens: number; outputTokens: number; calls: number; inputCost: number; outputCost: number; totalCost: number }>;
    byDay: Array<{ date: string; inputTokens: number; outputTokens: number; calls: number; cost: number }>;
    byType: Record<string, { inputTokens: number; outputTokens: number; calls: number }>;
    messageCount: number;
  }>(url);
};

// Budget
export interface BudgetResponse {
  allowed: boolean;
  currentDayCost: number;
  currentMonthCost: number;
  dailyLimit: number;
  monthlyLimit: number;
  hardLimit: boolean;
  alerts: string[];
  stats: {
    totalCost: number;
    byModel: Array<{ model: string; provider: string; inputTokens: number; outputTokens: number; inputCost: number; outputCost: number; totalCost: number; calls: number }>;
    byDay: Array<{ date: string; cost: number; inputTokens: number; outputTokens: number }>;
    currentMonthCost: number;
    currentDayCost: number;
  };
}
export const getBudget = () => request<BudgetResponse>('/api/budget');

// Engagement
export interface EngagementStatus {
  enabled: boolean;
  recentMessageCount: number;
  channels: Record<string, { onCooldown: boolean; dailyCount: number }>;
}
export interface EngagementTriggerResponse {
  triggered: number;
  skipped: number;
  results: Array<{ channelId: string; triggerType: string; messagePreview: string }>;
}
export const getEngagementStatus = () => request<EngagementStatus>('/api/proactive/status');
export const triggerEngagement = () =>
  request<EngagementTriggerResponse>('/api/proactive/trigger', { method: 'POST' });

