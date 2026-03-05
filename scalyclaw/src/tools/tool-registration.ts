import { registerTool } from './tool-registry.js';
import type { QueueKey } from '@scalyclaw/shared/queue/queue.js';

// ─── Memory ───
import { handleMemoryStore, handleMemorySearch, handleMemoryRecall, handleMemoryUpdate, handleMemoryDelete, handleMemoryReflect, handleMemoryGraph } from './handlers/memory.js';

registerTool('memory_store', handleMemoryStore);
registerTool('memory_search', handleMemorySearch);
registerTool('memory_recall', handleMemoryRecall);
registerTool('memory_update', handleMemoryUpdate);
registerTool('memory_delete', handleMemoryDelete);
registerTool('memory_reflect', handleMemoryReflect);
registerTool('memory_graph', handleMemoryGraph);

// ─── Messaging ───
import { handleSendMessage, handleSendFile } from './handlers/messaging.js';

registerTool('send_message', handleSendMessage);
registerTool('send_file', handleSendFile);

// ─── Agents (management) ───
import { handleListAgents, handleCreateAgent, handleUpdateAgent, handleDeleteAgent, withAgentConfig } from './handlers/agents.js';

registerTool('list_agents', handleListAgents);
registerTool('create_agent', handleCreateAgent);
registerTool('update_agent', handleUpdateAgent);
registerTool('delete_agent', handleDeleteAgent);
registerTool('toggle_agent', async (input) => {
  const id = input.id as string;
  const enabled = input.enabled as boolean;
  if (!id || typeof enabled !== 'boolean') return JSON.stringify({ error: 'Missing required fields: id, enabled' });
  return withAgentConfig(id, (agent) => { agent.enabled = enabled; return { toggled: true, enabled }; });
});
registerTool('set_agent_models', async (input) =>
  withAgentConfig(input.agentId as string, (agent) => {
    const models = input.models as { model: string; weight?: number; priority?: number }[];
    agent.models = models.map(m => ({ model: m.model, weight: m.weight ?? 1, priority: m.priority ?? 1 }));
    return { modelCount: agent.models.length };
  }),
);
registerTool('set_agent_skills', async (input) =>
  withAgentConfig(input.agentId as string, (agent) => {
    agent.skills = input.skills as string[];
    return { skillCount: agent.skills.length };
  }),
);
registerTool('set_agent_tools', async (input) =>
  withAgentConfig(input.agentId as string, (agent) => {
    agent.tools = input.tools as string[];
    return { toolCount: agent.tools.length };
  }),
);
registerTool('set_agent_mcps', async (input) =>
  withAgentConfig(input.agentId as string, (agent) => {
    agent.mcpServers = input.mcpServers as string[];
    return { mcpServerCount: agent.mcpServers.length };
  }),
);

// ─── Vault ───
import { storeSecret, resolveSecret, deleteSecret, listSecrets } from './handlers/admin.js';

registerTool('vault_store', async (input) => {
  const name = input.name as string;
  await storeSecret(name, input.value as string);
  return JSON.stringify({ stored: true, name });
});
registerTool('vault_check', async (input) => {
  const name = input.name as string;
  const value = await resolveSecret(name);
  return JSON.stringify({ found: value !== null, name });
});
registerTool('vault_delete', async (input) => {
  const name = input.name as string;
  const deleted = await deleteSecret(name);
  return JSON.stringify({ deleted, name });
});
registerTool('vault_list', async () => JSON.stringify({ secrets: await listSecrets() }));

// ─── Scheduling ───
import { handleScheduleReminder, handleScheduleRecurrentReminder, handleScheduleTask, handleScheduleRecurrentTask, listReminders, listTasks, cancelReminder, cancelTask } from './handlers/scheduling.js';

registerTool('schedule_reminder', handleScheduleReminder);
registerTool('schedule_recurrent_reminder', handleScheduleRecurrentReminder);
registerTool('schedule_task', handleScheduleTask);
registerTool('schedule_recurrent_task', handleScheduleRecurrentTask);
registerTool('list_reminders', async (_input, ctx) => JSON.stringify({ jobs: await listReminders(ctx.channelId) }));
registerTool('list_tasks', async (_input, ctx) => JSON.stringify({ jobs: await listTasks(ctx.channelId) }));
registerTool('cancel_reminder', async (input, ctx) => {
  const jobId = input.jobId as string;
  if (!jobId) return JSON.stringify({ error: 'Missing required field: jobId' });
  const result = await cancelReminder(jobId, ctx.channelId);
  return JSON.stringify({ ...result, jobId });
});
registerTool('cancel_task', async (input, ctx) => {
  const jobId = input.jobId as string;
  if (!jobId) return JSON.stringify({ error: 'Missing required field: jobId' });
  const result = await cancelTask(jobId, ctx.channelId);
  return JSON.stringify({ ...result, jobId });
});

// ─── Model management ───
import { handleListModels, handleToggleModel } from './handlers/admin.js';

registerTool('list_models', handleListModels);
registerTool('toggle_model', handleToggleModel);

// ─── Skill management ───
import { handleListSkills, handleToggleSkill, handleDeleteSkill, handleRegisterSkill } from './handlers/admin.js';

registerTool('list_skills', handleListSkills);
registerTool('toggle_skill', handleToggleSkill);
registerTool('delete_skill', handleDeleteSkill);
registerTool('register_skill', handleRegisterSkill);

// ─── Guards ───
import { handleListGuards, handleToggleGuard } from './handlers/admin.js';

registerTool('list_guards', handleListGuards);
registerTool('toggle_guard', handleToggleGuard);

// ─── Config ───
import { handleGetConfig, handleUpdateConfig } from './handlers/admin.js';

registerTool('get_config', handleGetConfig);
registerTool('update_config', handleUpdateConfig);

// ─── Usage ───
import { handleGetUsage } from './handlers/admin.js';

registerTool('get_usage', handleGetUsage);

// ─── Queue/Process management ───
import { handleListQueues, handlePauseQueue, handleResumeQueue, handleCleanQueue, listProcesses } from './handlers/admin.js';

registerTool('list_processes', async () => {
  const { getRedis } = await import('@scalyclaw/shared/core/redis.js');
  return JSON.stringify({ processes: await listProcesses(getRedis()) });
});
registerTool('list_queues', handleListQueues);
registerTool('list_jobs', async (input) => {
  const { queryJobs } = await import('./handlers/jobs.js');
  const jobs = await queryJobs({
    queueKey: input.queue as QueueKey | undefined,
    status: input.status as string | undefined,
    limit: (input.limit as number) ?? 20,
    defaultStatuses: ['waiting', 'active', 'completed', 'failed', 'delayed'],
  });
  return JSON.stringify({ jobs });
});
registerTool('pause_queue', handlePauseQueue);
registerTool('resume_queue', handleResumeQueue);
registerTool('clean_queue', handleCleanQueue);

// ─── File I/O ───
import { handleListDirectory, handleFileRead, handleFileWrite, handleFileEdit, handleFileOps } from './handlers/files.js';

registerTool('list_directory', handleListDirectory);
registerTool('file_read', handleFileRead);
registerTool('file_write', handleFileWrite);
registerTool('file_edit', handleFileEdit);
registerTool('file_ops', handleFileOps);

// ─── System ───
import { handleSystemInfo, handleCompactContext } from './handlers/system.js';

registerTool('system_info', handleSystemInfo);
registerTool('compact_context', handleCompactContext);

// ─── Job submission & management ───
import { handleSubmitJob, handleSubmitParallelJobs, handleStopJob, handleDeleteJob } from './handlers/jobs.js';

registerTool('submit_job', handleSubmitJob);
registerTool('submit_parallel_jobs', handleSubmitParallelJobs);
registerTool('get_job', async (input) => {
  const jobId = input.jobId as string;
  if (!jobId) return JSON.stringify({ error: 'Missing required field: jobId' });
  const { getJobStatus } = await import('@scalyclaw/shared/queue/queue.js');
  return JSON.stringify(await getJobStatus(jobId));
});
registerTool('list_active_jobs', async (input) => {
  const { queryJobs } = await import('./handlers/jobs.js');
  const jobs = await queryJobs({
    queueKey: input.queue as QueueKey | undefined,
    status: input.status as string | undefined,
    limit: (input.limit as number) ?? 20,
    defaultStatuses: ['waiting', 'active', 'delayed'],
  });
  return JSON.stringify({ jobs });
});
registerTool('stop_job', handleStopJob);
registerTool('delete_job', handleDeleteJob);
