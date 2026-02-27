import { useState, useEffect, useCallback, useRef } from 'react';
import { Settings, Trash2, RotateCw, Eye, XCircle, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { getJobs, getJobCounts, deleteJob, retryJob, failJob, completeJob } from '@/lib/api';
import { useApi } from '@/hooks/use-api';
import { useConfigSection } from '@/hooks/use-config-section';
import { formatDate } from '@/lib/utils';
import { Field, SectionCard } from '@/components/shared/ConfigFields';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/table';
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';

interface QueueConfig {
  lockDuration: number;
  stalledInterval: number;
  limiter: { max: number; duration: number };
  removeOnComplete: { age: number; count: number };
  removeOnFail: { age: number };
}

const QUEUE_KEYS = ['messages', 'agents', 'tools', 'proactive', 'scheduler', 'system'] as const;
type QueueKey = (typeof QUEUE_KEYS)[number];

const QUEUE_LABELS: Record<QueueKey, string> = {
  messages: 'Messages',
  agents: 'Agents',
  tools: 'Tools',
  proactive: 'Proactive',
  scheduler: 'Scheduler',
  system: 'System',
};

const STATUSES = ['active', 'waiting', 'completed', 'failed', 'delayed'] as const;
type Status = (typeof STATUSES)[number];

const AUTO_REFRESH_INTERVAL = 10_000;

export default function Jobs() {
  const [queueTab, setQueueTab] = useState<'all' | QueueKey>('all');
  const [statusTab, setStatusTab] = useState<Status>('active');
  const [selectedJob, setSelectedJob] = useState<Record<string, unknown> | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const config = useConfigSection<QueueConfig>('queue');

  const queueFilter = queueTab === 'all' ? undefined : queueTab;

  const { data, error, loading, refetch } = useApi(
    useCallback(() => getJobs(statusTab, queueFilter), [statusTab, queueFilter]),
    [statusTab, queueFilter],
  );

  const { data: countsData, refetch: refetchCounts } = useApi(
    useCallback(() => getJobCounts(queueFilter), [queueFilter]),
    [queueFilter],
  );

  // Auto-refresh on "active" status tab
  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    if (statusTab === 'active') {
      intervalRef.current = setInterval(() => {
        refetch();
        refetchCounts();
      }, AUTO_REFRESH_INTERVAL);
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [statusTab, refetch, refetchCounts]);

  const jobs = data?.jobs ?? [];

  // Aggregate counts for status badges
  const statusCounts: Record<Status, number> = { active: 0, waiting: 0, completed: 0, failed: 0, delayed: 0 };
  if (countsData?.counts) {
    for (const queueCounts of Object.values(countsData.counts)) {
      for (const s of STATUSES) {
        statusCounts[s] += queueCounts[s] ?? 0;
      }
    }
  }

  // Queue-level total counts (across all statuses)
  const queueTotalCounts: Record<string, number> = {};
  if (countsData?.counts) {
    for (const [qKey, queueCounts] of Object.entries(countsData.counts)) {
      let total = 0;
      for (const c of Object.values(queueCounts)) total += c;
      queueTotalCounts[qKey] = total;
    }
  }

  async function handleDelete(job: Record<string, unknown>) {
    const queue = queueNameToKey(String(job.queue ?? ''));
    const id = String(job.id ?? '');
    if (!queue || !id) return;
    if (!window.confirm(`Delete job #${id} from ${queue}?`)) return;

    setActionLoading(id);
    try {
      await deleteJob(queue, id);
      toast.success(`Job #${id} deleted.`);
      refetch();
      refetchCounts();
    } catch (err) {
      toast.error('Failed to delete job', {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setActionLoading(null);
    }
  }

  async function handleRetry(job: Record<string, unknown>) {
    const queue = queueNameToKey(String(job.queue ?? ''));
    const id = String(job.id ?? '');
    if (!queue || !id) return;

    setActionLoading(id);
    try {
      await retryJob(queue, id);
      toast.success(`Job #${id} retried.`);
      refetch();
      refetchCounts();
    } catch (err) {
      toast.error('Failed to retry job', {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setActionLoading(null);
    }
  }

  async function handleFail(job: Record<string, unknown>) {
    const queue = queueNameToKey(String(job.queue ?? ''));
    const id = String(job.id ?? '');
    if (!queue || !id) return;
    if (!window.confirm(`Fail job #${id}?`)) return;

    setActionLoading(id);
    try {
      await failJob(queue, id);
      toast.success(`Job #${id} failed.`);
      refetch();
      refetchCounts();
    } catch (err) {
      toast.error('Failed to fail job', {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setActionLoading(null);
    }
  }

  async function handleComplete(job: Record<string, unknown>) {
    const queue = queueNameToKey(String(job.queue ?? ''));
    const id = String(job.id ?? '');
    if (!queue || !id) return;
    if (!window.confirm(`Complete job #${id}?`)) return;

    setActionLoading(id);
    try {
      await completeJob(queue, id);
      toast.success(`Job #${id} completed.`);
      refetch();
      refetchCounts();
    } catch (err) {
      toast.error('Failed to complete job', {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setActionLoading(null);
    }
  }

  function handleRefresh() {
    refetch();
    refetchCounts();
  }

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Jobs</h1>
        <div className="flex items-center gap-2">
          {statusTab === 'active' && (
            <Badge variant="outline" className="text-xs">
              Auto-refresh
            </Badge>
          )}
          <Button variant="ghost" size="sm" onClick={() => setSettingsOpen(true)} title="Queue settings">
            <Settings className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={handleRefresh}>
            Refresh
          </Button>
        </div>
      </div>

      {/* Queue tabs */}
      <Tabs value={queueTab} onValueChange={(v) => setQueueTab(v as 'all' | QueueKey)}>
        <div className="flex items-center gap-3">
        <span className="text-sm font-medium text-muted-foreground">Queues</span>
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          {QUEUE_KEYS.map((key) => (
            <TabsTrigger key={key} value={key}>
              {QUEUE_LABELS[key]}
              {(queueTotalCounts[key] ?? 0) > 0 && (
                <Badge variant="secondary" className="ml-1.5 px-1.5 py-0 text-[10px]">
                  {queueTotalCounts[key]}
                </Badge>
              )}
            </TabsTrigger>
          ))}
        </TabsList>
        </div>

        {/* All queue tabs share the same content — the status tabs + table below */}
        <TabsContent value="all" className="mt-0" />
        {QUEUE_KEYS.map((key) => (
          <TabsContent key={key} value={key} className="mt-0" />
        ))}
      </Tabs>

      {/* Status tabs */}
      <Tabs value={statusTab} onValueChange={(v) => setStatusTab(v as Status)}>
        <div className="flex items-center gap-3">
        <span className="text-sm font-medium text-muted-foreground">Jobs</span>
        <TabsList>
          {STATUSES.map((status) => (
            <TabsTrigger key={status} value={status} className="capitalize">
              {status}
              {statusCounts[status] > 0 && (
                <Badge
                  variant={status === 'failed' ? 'destructive' : 'secondary'}
                  className="ml-1.5 px-1.5 py-0 text-[10px]"
                >
                  {statusCounts[status]}
                </Badge>
              )}
            </TabsTrigger>
          ))}
        </TabsList>
        </div>

        {STATUSES.map((status) => (
          <TabsContent key={status} value={status}>
            <JobTable
              status={status}
              jobs={jobs}
              loading={loading}
              error={error}
              showQueue={queueTab === 'all'}
              actionLoading={actionLoading}
              onView={setSelectedJob}
              onDelete={handleDelete}
              onRetry={handleRetry}
              onFail={handleFail}
              onComplete={handleComplete}
              onRefresh={handleRefresh}
            />
          </TabsContent>
        ))}
      </Tabs>

      {/* Job detail dialog */}
      <Dialog open={selectedJob !== null} onOpenChange={(open) => { if (!open) setSelectedJob(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Job Details{' '}
              {selectedJob && (
                <span className="font-mono text-sm font-normal text-muted-foreground">
                  #{String(selectedJob.id ?? '')}
                </span>
              )}
            </DialogTitle>
          </DialogHeader>
          {selectedJob && (
            <pre className="overflow-x-auto rounded-md bg-muted p-4 text-sm">
              {JSON.stringify(selectedJob, null, 2)}
            </pre>
          )}
        </DialogContent>
      </Dialog>

      {/* Settings dialog */}
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Queue Settings
              {config.dirty && <Badge variant="secondary" className="ml-2">Unsaved</Badge>}
            </DialogTitle>
          </DialogHeader>
          {config.loading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : config.section ? (
            <ScrollArea className="max-h-[60vh]">
              <div className="space-y-4 pr-4">
                <SectionCard title="Queue">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Lock Duration" description="Job lock duration in ms">
                      <Input
                        type="number"
                        value={String(config.section.lockDuration)}
                        onChange={(e) => config.update((c) => { c.lockDuration = Number(e.target.value); })}
                      />
                    </Field>
                    <Field label="Stalled Interval" description="Check interval for stalled jobs in ms">
                      <Input
                        type="number"
                        value={String(config.section.stalledInterval)}
                        onChange={(e) => config.update((c) => { c.stalledInterval = Number(e.target.value); })}
                      />
                    </Field>
                  </div>
                </SectionCard>

                <SectionCard title="Rate Limiter">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Max Jobs" description="Maximum jobs per duration window">
                      <Input
                        type="number"
                        value={String(config.section.limiter.max)}
                        onChange={(e) => config.update((c) => { c.limiter.max = Number(e.target.value); })}
                      />
                    </Field>
                    <Field label="Duration" description="Window duration in ms">
                      <Input
                        type="number"
                        value={String(config.section.limiter.duration)}
                        onChange={(e) => config.update((c) => { c.limiter.duration = Number(e.target.value); })}
                      />
                    </Field>
                  </div>
                </SectionCard>

                <SectionCard title="Cleanup">
                  <div className="grid gap-4 sm:grid-cols-3">
                    <Field label="Completed: Max Age" description="Seconds to keep completed jobs">
                      <Input
                        type="number"
                        value={String(config.section.removeOnComplete.age)}
                        onChange={(e) => config.update((c) => { c.removeOnComplete.age = Number(e.target.value); })}
                      />
                    </Field>
                    <Field label="Completed: Max Count" description="Max completed jobs to keep">
                      <Input
                        type="number"
                        value={String(config.section.removeOnComplete.count)}
                        onChange={(e) => config.update((c) => { c.removeOnComplete.count = Number(e.target.value); })}
                      />
                    </Field>
                    <Field label="Failed: Max Age" description="Seconds to keep failed jobs">
                      <Input
                        type="number"
                        value={String(config.section.removeOnFail.age)}
                        onChange={(e) => config.update((c) => { c.removeOnFail.age = Number(e.target.value); })}
                      />
                    </Field>
                  </div>
                </SectionCard>
              </div>
            </ScrollArea>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => { config.reset(); setSettingsOpen(false); }}>
              Cancel
            </Button>
            <Button onClick={async () => { await config.save(); setSettingsOpen(false); }} disabled={config.saving || !config.dirty}>
              {config.saving ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Helpers ───

/** Map BullMQ queue name (e.g. "scalyclaw-messages") back to queue key (e.g. "messages") */
function queueNameToKey(queueName: string): string | null {
  const prefix = 'scalyclaw-';
  if (queueName.startsWith(prefix)) return queueName.slice(prefix.length);
  // Already a key?
  if (QUEUE_KEYS.includes(queueName as QueueKey)) return queueName;
  return null;
}

function statusColor(status: Status): string {
  switch (status) {
    case 'active': return 'bg-blue-500';
    case 'waiting': return 'bg-yellow-500';
    case 'completed': return 'bg-emerald-500';
    case 'failed': return 'bg-red-500';
    case 'delayed': return 'bg-purple-500';
    default: return 'bg-muted-foreground';
  }
}

// ─── Job Table ───

interface JobTableProps {
  status: Status;
  jobs: Array<Record<string, unknown>>;
  loading: boolean;
  error: string | null;
  showQueue: boolean;
  actionLoading: string | null;
  onView: (job: Record<string, unknown>) => void;
  onDelete: (job: Record<string, unknown>) => void;
  onRetry: (job: Record<string, unknown>) => void;
  onFail: (job: Record<string, unknown>) => void;
  onComplete: (job: Record<string, unknown>) => void;
  onRefresh: () => void;
}

function JobTable({ status, jobs, loading, error, showQueue, actionLoading, onView, onDelete, onRetry, onFail, onComplete, onRefresh }: JobTableProps) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        Loading jobs...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-12">
        <p className="text-sm text-destructive">{error}</p>
        <Button variant="outline" size="sm" onClick={onRefresh}>
          Retry
        </Button>
      </div>
    );
  }

  if (jobs.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No {status} jobs.
      </p>
    );
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>ID</TableHead>
            <TableHead>Name</TableHead>
            {showQueue && <TableHead>Queue</TableHead>}
            <TableHead>Created</TableHead>
            <TableHead>Processed</TableHead>
            <TableHead>Finished</TableHead>
            {status === 'failed' && <TableHead>Reason</TableHead>}
            <TableHead className="w-[120px] text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {jobs.map((job) => {
            const id = String(job.id ?? '-');
            const name = String(job.name ?? '-');
            const queue = String(job.queue ?? '-');
            const queueKey = queueNameToKey(queue);
            const timestamp = job.timestamp ? formatDate(job.timestamp as string | number) : '-';
            const processedOn = job.processedOn ? formatDate(job.processedOn as string | number) : '-';
            const finishedOn = job.finishedOn ? formatDate(job.finishedOn as string | number) : '-';
            const failedReason = job.failedReason ? String(job.failedReason) : null;
            const isLoading = actionLoading === id;

            return (
              <TableRow key={`${queue}-${id}`}>
                <TableCell className="font-mono text-sm">{id}</TableCell>
                <TableCell>{name}</TableCell>
                {showQueue && (
                  <TableCell>
                    <Badge variant="outline" className="text-xs capitalize">
                      {queueKey ?? queue}
                    </Badge>
                  </TableCell>
                )}
                <TableCell className="text-sm">{timestamp}</TableCell>
                <TableCell className="text-sm">{processedOn}</TableCell>
                <TableCell className="text-sm">{finishedOn}</TableCell>
                {status === 'failed' && (
                  <TableCell>
                    {failedReason ? (
                      <span className="text-sm text-red-500" title={failedReason}>
                        {failedReason.length > 80 ? failedReason.slice(0, 80) + '...' : failedReason}
                      </span>
                    ) : '-'}
                  </TableCell>
                )}
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      title="View details"
                      onClick={() => onView(job)}
                    >
                      <Eye className="h-3.5 w-3.5" />
                    </Button>
                    {(status === 'active' || status === 'waiting' || status === 'delayed') && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-emerald-600 hover:text-emerald-600"
                        title="Complete job"
                        disabled={isLoading}
                        onClick={(e) => { e.stopPropagation(); onComplete(job); }}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    {(status === 'active' || status === 'waiting' || status === 'delayed') && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-orange-500 hover:text-orange-500"
                        title="Fail job"
                        disabled={isLoading}
                        onClick={(e) => { e.stopPropagation(); onFail(job); }}
                      >
                        <XCircle className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    {status === 'failed' && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        title="Retry job"
                        disabled={isLoading}
                        onClick={(e) => { e.stopPropagation(); onRetry(job); }}
                      >
                        <RotateCw className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    {status !== 'active' && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        title="Delete job"
                        disabled={isLoading}
                        onClick={(e) => { e.stopPropagation(); onDelete(job); }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
