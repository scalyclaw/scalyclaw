import { useEffect } from 'react';
import { RefreshCw } from 'lucide-react';
import {
  getStatus,
  getWorkers,
  getModels,
  getAgents,
  getSkills,
  listMemory,
  getChannels,
  getMcpServers,
  getSchedulerJobs,
  getJobs,
  getUsage,
  getBudget,
} from '@/lib/api';
import { useApi } from '@/hooks/use-api';
import { formatDuration, formatBytes } from '@/lib/utils';
import { Row } from '@/components/shared/Row';
import { ProgressBar } from '@/components/shared/ProgressBar';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

export default function Overview() {
  const status = useApi(getStatus);
  const workers = useApi(getWorkers);
  const models = useApi(getModels);
  const agents = useApi(getAgents);
  const skills = useApi(getSkills);
  const memory = useApi(listMemory);
  const channels = useApi(getChannels);
  const mcp = useApi(getMcpServers);
  const scheduler = useApi(getSchedulerJobs);
  const jobs = useApi(() => getJobs('active'));
  const usage = useApi(getUsage);
  const budget = useApi(getBudget);

  // Auto-refresh every 15s
  useEffect(() => {
    const interval = setInterval(() => {
      status.refetch();
      workers.refetch();
      jobs.refetch();
    }, 15_000);
    return () => clearInterval(interval);
  }, [status.refetch, workers.refetch, jobs.refetch]);

  function refetchAll() {
    status.refetch();
    workers.refetch();
    models.refetch();
    agents.refetch();
    skills.refetch();
    memory.refetch();
    channels.refetch();
    mcp.refetch();
    scheduler.refetch();
    jobs.refetch();
    usage.refetch();
    budget.refetch();
  }

  const mainNode = (workers.data?.workers ?? []).find((w) => String(w.type) === 'node') as Record<string, unknown> | undefined;
  const workerNodes = (workers.data?.workers ?? []).filter((w) => String(w.type) === 'worker');
  const mcpServers = mcp.data?.servers ?? [];
  const mcpToolCount = mcpServers.reduce((sum, s) => sum + ((s.tools as unknown[])?.length ?? 0), 0);
  const channelList = channels.data?.channels ?? [];

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Overview</h1>
        <Button variant="outline" size="sm" onClick={refetchAll}>
          <RefreshCw className="mr-2 h-3.5 w-3.5" /> Refresh
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {/* Node */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Node</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {mainNode ? (
              <>
                <Row label="Hostname" value={String(mainNode.hostname ?? '-')} />
                <Row label="Address" value={mainNode.host && mainNode.port ? `${mainNode.host}:${mainNode.port}` : '-'} mono />
                <Row label="Uptime" value={typeof mainNode.uptime === 'number' ? formatDuration(mainNode.uptime) : '-'} />
                <Row label="Version" value={String(mainNode.version ?? '-')} />
                {status.data?.memory && (
                  <Row label="Memory" value={formatBytes((status.data.memory as { rss: number }).rss)} />
                )}
              </>
            ) : (
              <p className="text-muted-foreground">Loading...</p>
            )}
          </CardContent>
        </Card>

        {/* Models */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Models</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <Row label="Chat" value={String(models.data?.models?.length ?? '-')} />
            <Row label="Embedding" value={String(models.data?.embeddingModels?.length ?? '-')} />
          </CardContent>
        </Card>

        {/* Usage */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Usage</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {usage.data ? (
              <>
                <Row label="Messages" value={usage.data.messageCount.toLocaleString()} />
                <Row label="Input Tokens" value={usage.data.totalInputTokens.toLocaleString()} />
                <Row label="Output Tokens" value={usage.data.totalOutputTokens.toLocaleString()} />
                <Row
                  label="Total Calls"
                  value={Object.values(usage.data.byType).reduce((s, t) => s + t.calls, 0).toLocaleString()}
                />
              </>
            ) : (
              <p className="text-muted-foreground">Loading...</p>
            )}
          </CardContent>
        </Card>

        {/* Budget */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Budget</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {budget.data ? (
              <>
                <Row
                  label="Month Cost"
                  value={`$${budget.data.currentMonthCost.toFixed(4)}`}
                />
                <Row
                  label="Limit"
                  value={budget.data.monthlyLimit > 0 ? `$${budget.data.monthlyLimit}` : 'No limit'}
                />
                <Row
                  label="Mode"
                  value={budget.data.hardLimit ? 'Hard' : 'Soft'}
                />
                {budget.data.monthlyLimit > 0 && (
                  <ProgressBar
                    value={budget.data.currentMonthCost}
                    max={budget.data.monthlyLimit}
                    label={`of $${budget.data.monthlyLimit}`}
                  />
                )}
              </>
            ) : (
              <p className="text-muted-foreground">Loading...</p>
            )}
          </CardContent>
        </Card>

        {/* Agents */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Agents</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <Row label="Count" value={String(agents.data?.agents?.length ?? '-')} />
          </CardContent>
        </Card>

        {/* Skills */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Skills</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <Row label="Count" value={String(skills.data?.skills?.length ?? '-')} />
          </CardContent>
        </Card>

        {/* Memory */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Memory</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <Row label="Stored" value={String(memory.data?.results?.length ?? '-')} />
          </CardContent>
        </Card>

        {/* Channels */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Channels</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            {channelList.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {channelList.map((ch, i) => (
                  <Badge key={i} variant="secondary">{String(ch.id ?? ch.type ?? i)}</Badge>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground">None</p>
            )}
          </CardContent>
        </Card>

        {/* MCP */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">MCP</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <Row label="Servers" value={String(mcpServers.length)} />
            <Row label="Tools" value={String(mcpToolCount)} />
          </CardContent>
        </Card>

        {/* Workers */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Workers</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <Row label="Count" value={String(workerNodes.length)} />
          </CardContent>
        </Card>

        {/* Scheduler */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Scheduler</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <Row label="Active Jobs" value={String(scheduler.data?.jobs?.length ?? '-')} />
          </CardContent>
        </Card>

        {/* Jobs */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Jobs</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <Row label="Active" value={String(jobs.data?.jobs?.length ?? '-')} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
