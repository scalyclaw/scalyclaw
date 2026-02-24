import { useState } from 'react';
import { Plus, Trash2, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  getSchedulerJobs,
  createReminder,
  createRecurrentReminder,
  createTask,
  createRecurrentTask,
  cancelSchedulerJob,
  completeSchedulerJob,
  purgeSchedulerJob,
} from '@/lib/api';
import { useApi } from '@/hooks/use-api';
import { formatDate } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from '@/components/ui/tabs';

type StateFilter = 'active' | 'all' | 'completed' | 'cancelled' | 'failed';

const STATE_BADGE: Record<string, { variant: 'default' | 'secondary' | 'destructive' | 'outline'; className: string; label: string }> = {
  active:    { variant: 'default',     className: 'bg-emerald-600 hover:bg-emerald-600', label: 'Active' },
  completed: { variant: 'secondary',   className: '',                                 label: 'Completed' },
  cancelled: { variant: 'destructive', className: '',                                 label: 'Cancelled' },
  failed:    { variant: 'outline',     className: 'border-orange-500 text-orange-500', label: 'Failed' },
};

const REMINDER_TYPES = new Set(['reminder', 'recurrent-reminder']);
const TASK_TYPES = new Set(['task', 'recurrent-task']);

export default function Scheduler() {
  const [filter, setFilter] = useState<StateFilter>('active');
  const [activeTab, setActiveTab] = useState<'reminders' | 'tasks'>('reminders');

  const { data, error, loading, refetch } = useApi(
    () => getSchedulerJobs(),
    [],
  );

  // Reminder dialogs
  const [reminderOpen, setReminderOpen] = useState(false);
  const [reminderDescription, setReminderDescription] = useState('');
  const [reminderRunAt, setReminderRunAt] = useState('');
  const [reminderSubmitting, setReminderSubmitting] = useState(false);

  const [recurrentReminderOpen, setRecurrentReminderOpen] = useState(false);
  const [recurrentReminderDescription, setRecurrentReminderDescription] = useState('');
  const [recurrentReminderCron, setRecurrentReminderCron] = useState('');
  const [recurrentReminderSubmitting, setRecurrentReminderSubmitting] = useState(false);

  // Task dialogs
  const [taskOpen, setTaskOpen] = useState(false);
  const [taskDescription, setTaskDescription] = useState('');
  const [taskRunAt, setTaskRunAt] = useState('');
  const [taskSubmitting, setTaskSubmitting] = useState(false);

  const [recurrentTaskOpen, setRecurrentTaskOpen] = useState(false);
  const [recurrentTaskDescription, setRecurrentTaskDescription] = useState('');
  const [recurrentTaskCron, setRecurrentTaskCron] = useState('');
  const [recurrentTaskTimezone, setRecurrentTaskTimezone] = useState('');
  const [recurrentTaskSubmitting, setRecurrentTaskSubmitting] = useState(false);

  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [purgingId, setPurgingId] = useState<string | null>(null);

  async function handleCreateReminder() {
    if (!reminderDescription || !reminderRunAt) {
      toast.error('All fields are required.');
      return;
    }
    setReminderSubmitting(true);
    try {
      await createReminder({
        description: reminderDescription,
        runAt: new Date(reminderRunAt).toISOString(),
      });
      toast.success('Reminder created.');
      setReminderOpen(false);
      setReminderDescription('');
      setReminderRunAt('');
      refetch();
    } catch (err) {
      toast.error('Failed to create reminder', {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setReminderSubmitting(false);
    }
  }

  async function handleCreateRecurrentReminder() {
    if (!recurrentReminderDescription || !recurrentReminderCron) {
      toast.error('All fields are required.');
      return;
    }
    setRecurrentReminderSubmitting(true);
    try {
      await createRecurrentReminder({
        description: recurrentReminderDescription,
        cron: recurrentReminderCron,
      });
      toast.success('Recurrent reminder created.');
      setRecurrentReminderOpen(false);
      setRecurrentReminderDescription('');
      setRecurrentReminderCron('');
      refetch();
    } catch (err) {
      toast.error('Failed to create recurrent reminder', {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setRecurrentReminderSubmitting(false);
    }
  }

  async function handleCreateTask() {
    if (!taskDescription || !taskRunAt) {
      toast.error('All fields are required.');
      return;
    }
    setTaskSubmitting(true);
    try {
      await createTask({
        description: taskDescription,
        runAt: new Date(taskRunAt).toISOString(),
      });
      toast.success('Task created.');
      setTaskOpen(false);
      setTaskDescription('');
      setTaskRunAt('');
      refetch();
    } catch (err) {
      toast.error('Failed to create task', {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setTaskSubmitting(false);
    }
  }

  async function handleCreateRecurrentTask() {
    if (!recurrentTaskDescription || !recurrentTaskCron) {
      toast.error('All fields are required.');
      return;
    }
    setRecurrentTaskSubmitting(true);
    try {
      await createRecurrentTask({
        description: recurrentTaskDescription,
        cron: recurrentTaskCron,
        ...(recurrentTaskTimezone && { timezone: recurrentTaskTimezone }),
      });
      toast.success('Recurrent task created.');
      setRecurrentTaskOpen(false);
      setRecurrentTaskDescription('');
      setRecurrentTaskCron('');
      setRecurrentTaskTimezone('');
      refetch();
    } catch (err) {
      toast.error('Failed to create recurrent task', {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setRecurrentTaskSubmitting(false);
    }
  }

  async function handleCancel(id: string) {
    if (!window.confirm(`Cancel scheduler job "${id}"?`)) return;
    setCancellingId(id);
    try {
      await cancelSchedulerJob(id);
      toast.success(`Job "${id}" cancelled.`);
      refetch();
    } catch (err) {
      toast.error('Failed to cancel job', {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setCancellingId(null);
    }
  }

  async function handleComplete(id: string) {
    if (!window.confirm(`Complete scheduler job "${id}"?`)) return;
    setCompletingId(id);
    try {
      await completeSchedulerJob(id);
      toast.success(`Job "${id}" completed.`);
      refetch();
    } catch (err) {
      toast.error('Failed to complete job', {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setCompletingId(null);
    }
  }

  async function handlePurge(id: string) {
    if (!window.confirm(`Permanently delete scheduler job "${id}"? This cannot be undone.`)) return;
    setPurgingId(id);
    try {
      await purgeSchedulerJob(id);
      toast.success(`Job "${id}" deleted.`);
      refetch();
    } catch (err) {
      toast.error('Failed to delete job', {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setPurgingId(null);
    }
  }

  // Client-side filter — API always returns all jobs
  const allJobs = data?.jobs ?? [];
  const filteredJobs = filter === 'all'
    ? allJobs
    : allJobs.filter((job) => String(job.state) === filter);

  const reminderJobs = filteredJobs.filter((job) => REMINDER_TYPES.has(String(job.type)));
  const taskJobs = filteredJobs.filter((job) => TASK_TYPES.has(String(job.type)));

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Loading scheduler jobs...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <p className="text-sm text-destructive">{error}</p>
        <Button variant="outline" size="sm" onClick={refetch}>
          Retry
        </Button>
      </div>
    );
  }

  const FILTERS: { value: StateFilter; label: string }[] = [
    { value: 'active', label: 'Active' },
    { value: 'all', label: 'All' },
    { value: 'completed', label: 'Completed' },
    { value: 'cancelled', label: 'Cancelled' },
    { value: 'failed', label: 'Failed' },
  ];

  function renderJobTable(jobs: Array<Record<string, unknown>>) {
    if (jobs.length === 0) {
      return <p className="text-sm text-muted-foreground">No jobs.</p>;
    }
    return (
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ID</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Cron</TableHead>
              <TableHead>Next Run</TableHead>
              <TableHead>State</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="w-[100px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {jobs.map((job) => {
              const id = String(job.id ?? '');
              const type = String(job.type ?? '-');
              const description = String(job.description ?? '-');
              const cron = job.cron ? String(job.cron) : '-';
              const nextRun = job.next_run ? formatDate(String(job.next_run)) : '-';
              const state = String(job.state ?? 'active');
              const createdAt = job.created_at ? formatDate(String(job.created_at)) : '-';
              const badge = STATE_BADGE[state] ?? STATE_BADGE.active;

              return (
                <TableRow key={id}>
                  <TableCell className="font-mono text-sm">{id}</TableCell>
                  <TableCell>{type}</TableCell>
                  <TableCell>{description}</TableCell>
                  <TableCell className="font-mono text-sm">{cron}</TableCell>
                  <TableCell>{nextRun}</TableCell>
                  <TableCell>
                    <Badge variant={badge.variant} className={badge.className}>
                      {badge.label}
                    </Badge>
                  </TableCell>
                  <TableCell>{createdAt}</TableCell>
                  <TableCell>
                    {state === 'active' ? (
                      <div className="flex items-center gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={completingId === id}
                          onClick={() => handleComplete(id)}
                          title="Complete job"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          disabled={cancellingId === id}
                          onClick={() => handleCancel(id)}
                          title="Cancel job"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        disabled={purgingId === id}
                        onClick={() => handlePurge(id)}
                        title="Permanently delete"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Scheduler</h1>
        <div className="flex items-center gap-2">
          {activeTab === 'reminders' ? (
            <>
              <Button size="sm" onClick={() => setReminderOpen(true)}>
                <Plus className="mr-1.5 h-3.5 w-3.5" /> Reminder
              </Button>
              <Button size="sm" onClick={() => setRecurrentReminderOpen(true)}>
                <Plus className="mr-1.5 h-3.5 w-3.5" /> Recurrent
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" onClick={() => setTaskOpen(true)}>
                <Plus className="mr-1.5 h-3.5 w-3.5" /> Task
              </Button>
              <Button size="sm" onClick={() => setRecurrentTaskOpen(true)}>
                <Plus className="mr-1.5 h-3.5 w-3.5" /> Recurrent
              </Button>
            </>
          )}
          <Button variant="outline" size="sm" onClick={refetch}>
            Refresh
          </Button>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'reminders' | 'tasks')}>
        <TabsList>
          <TabsTrigger value="reminders">Reminders</TabsTrigger>
          <TabsTrigger value="tasks">Tasks</TabsTrigger>
        </TabsList>
      </Tabs>

      {/* State filter pills */}
      <div className="flex items-center gap-1">
        {FILTERS.map((f) => (
          <Button
            key={f.value}
            variant={filter === f.value ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setFilter(f.value)}
          >
            {f.label}
          </Button>
        ))}
      </div>

      {activeTab === 'reminders' ? renderJobTable(reminderJobs) : renderJobTable(taskJobs)}

      {/* Reminder dialog */}
      <Dialog open={reminderOpen} onOpenChange={setReminderOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Create Reminder</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="reminder-description">Description</Label>
              <Input
                id="reminder-description"
                value={reminderDescription}
                onChange={(e) => setReminderDescription(e.target.value)}
                placeholder="Remind me to..."
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="reminder-runat">Run At</Label>
              <Input
                id="reminder-runat"
                type="datetime-local"
                value={reminderRunAt}
                onChange={(e) => setReminderRunAt(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReminderOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleCreateReminder}
              disabled={reminderSubmitting}
            >
              {reminderSubmitting ? 'Creating...' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Recurrent Reminder dialog */}
      <Dialog open={recurrentReminderOpen} onOpenChange={setRecurrentReminderOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Create Recurrent Reminder</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="rec-reminder-description">Description</Label>
              <Input
                id="rec-reminder-description"
                value={recurrentReminderDescription}
                onChange={(e) => setRecurrentReminderDescription(e.target.value)}
                placeholder="Daily standup reminder"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rec-reminder-cron">Cron Expression</Label>
              <Input
                id="rec-reminder-cron"
                value={recurrentReminderCron}
                onChange={(e) => setRecurrentReminderCron(e.target.value)}
                placeholder="0 9 * * *"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRecurrentReminderOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleCreateRecurrentReminder}
              disabled={recurrentReminderSubmitting}
            >
              {recurrentReminderSubmitting ? 'Creating...' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Task dialog */}
      <Dialog open={taskOpen} onOpenChange={setTaskOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Create Task</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="task-description">Description</Label>
              <Input
                id="task-description"
                value={taskDescription}
                onChange={(e) => setTaskDescription(e.target.value)}
                placeholder="Check weather and summarize"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="task-runat">Run At</Label>
              <Input
                id="task-runat"
                type="datetime-local"
                value={taskRunAt}
                onChange={(e) => setTaskRunAt(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTaskOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleCreateTask}
              disabled={taskSubmitting}
            >
              {taskSubmitting ? 'Creating...' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Recurrent Task dialog */}
      <Dialog open={recurrentTaskOpen} onOpenChange={setRecurrentTaskOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Create Recurrent Task</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="rec-task-description">Description</Label>
              <Input
                id="rec-task-description"
                value={recurrentTaskDescription}
                onChange={(e) => setRecurrentTaskDescription(e.target.value)}
                placeholder="Summarize inbox"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rec-task-cron">Cron Expression</Label>
              <Input
                id="rec-task-cron"
                value={recurrentTaskCron}
                onChange={(e) => setRecurrentTaskCron(e.target.value)}
                placeholder="0 9 * * *"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rec-task-timezone">Timezone (optional)</Label>
              <Input
                id="rec-task-timezone"
                value={recurrentTaskTimezone}
                onChange={(e) => setRecurrentTaskTimezone(e.target.value)}
                placeholder="America/New_York"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRecurrentTaskOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleCreateRecurrentTask}
              disabled={recurrentTaskSubmitting}
            >
              {recurrentTaskSubmitting ? 'Creating...' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
