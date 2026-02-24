import { useState, useEffect } from 'react';
import { Check, ChevronsUpDown, Pencil, Trash2, Plus } from 'lucide-react';
import {
  getAgents,
  getModels,
  getSkills,
  createAgent,
  updateAgent,
  deleteAgent,
  toggleAgent,
  getAgentEligibleTools,
  getMcpServers,
} from '@/lib/api';
import { useApi } from '@/hooks/use-api';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
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
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';

interface AgentForm {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  maxIterations: number;
  models: string[];
  skills: string[];
  tools: string[];
  mcpServers: string[];
}

const emptyForm: AgentForm = {
  id: '',
  name: '',
  description: '',
  systemPrompt: '',
  maxIterations: 25,
  models: ['auto'],
  skills: [],
  tools: [],
  mcpServers: [],
};

function MultiSelect({
  label,
  selected,
  options,
  onChange,
}: {
  label: string;
  selected: string[];
  options: string[];
  onChange: (values: string[]) => void;
}) {
  function toggle(value: string) {
    onChange(
      selected.includes(value)
        ? selected.filter((v) => v !== value)
        : [...selected, value],
    );
  }

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className="w-full justify-between font-normal">
            {selected.length > 0 ? (
              <span className="truncate">{selected.length} selected</span>
            ) : (
              <span className="text-muted-foreground">Select...</span>
            )}
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="max-h-60 w-[--radix-dropdown-menu-trigger-width] overflow-y-auto">
          {options.length === 0 ? (
            <div className="px-2 py-1.5 text-sm text-muted-foreground">None available</div>
          ) : (
            options.map((opt) => (
              <DropdownMenuItem
                key={opt}
                onSelect={(e) => {
                  e.preventDefault();
                  toggle(opt);
                }}
              >
                <Check className={cn('mr-2 h-4 w-4', selected.includes(opt) ? 'opacity-100' : 'opacity-0')} />
                {opt}
              </DropdownMenuItem>
            ))
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selected.map((v) => (
            <Badge
              key={v}
              variant="secondary"
              className="cursor-pointer"
              onClick={() => toggle(v)}
            >
              {v} &times;
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Agents() {
  const { data, error, loading, refetch } = useApi(getAgents);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<AgentForm>(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [availableSkills, setAvailableSkills] = useState<string[]>([]);
  const [availableTools, setAvailableTools] = useState<string[]>([]);
  const [availableMcpServers, setAvailableMcpServers] = useState<string[]>([]);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  useEffect(() => {
    if (!dialogOpen) return;
    getModels()
      .then((res) => setAvailableModels(res.models.map((m) => String(m.id ?? '')).filter(Boolean)))
      .catch(() => {});
    getSkills()
      .then((res) => {
        const ids = res.skills.map((s) => String(s.id ?? '')).filter(Boolean);
        setAvailableSkills(ids);
        if (!editingId) setForm((prev) => ({ ...prev, skills: ids }));
      })
      .catch(() => {});
    getAgentEligibleTools()
      .then((res) => {
        setAvailableTools(res.tools);
        if (!editingId) setForm((prev) => ({ ...prev, tools: res.tools }));
      })
      .catch(() => {});
    getMcpServers()
      .then((res) => {
        const ids = res.servers.map((s) => String(s.id ?? '')).filter(Boolean);
        setAvailableMcpServers(ids);
      })
      .catch(() => {});
  }, [dialogOpen, editingId]);

  function openCreate() {
    setEditingId(null);
    setForm(emptyForm);
    setDialogOpen(true);
  }

  function openEdit(agent: Record<string, unknown>) {
    const id = String(agent.id ?? '');
    setEditingId(id);
    setForm({
      id,
      name: String(agent.name ?? ''),
      description: String(agent.description ?? ''),
      systemPrompt: String(agent.systemPrompt ?? ''),
      maxIterations: typeof agent.maxIterations === 'number' ? agent.maxIterations : 25,
      models: Array.isArray(agent.models)
        ? agent.models.map((m: any) => typeof m === 'string' ? m : m.model)
        : [],
      skills: Array.isArray(agent.skills) ? (agent.skills as string[]) : [],
      tools: Array.isArray(agent.tools) ? (agent.tools as string[]) : [],
      mcpServers: Array.isArray(agent.mcpServers) ? (agent.mcpServers as string[]) : [],
    });
    setDialogOpen(true);
  }

  async function handleSubmit() {
    if (!form.id.trim() || !form.name.trim()) {
      toast.error('ID and Name are required');
      return;
    }

    setSubmitting(true);
    const payload: Record<string, unknown> = {
      id: form.id.trim(),
      name: form.name.trim(),
      description: form.description.trim(),
      systemPrompt: form.systemPrompt,
      maxIterations: form.maxIterations,
      models: form.models.map(m => ({ model: m, weight: 1, priority: 1 })),
      skills: form.skills,
      tools: form.tools,
      mcpServers: form.mcpServers,
    };

    try {
      if (editingId) {
        await updateAgent(editingId, payload);
        toast.success(`Agent "${editingId}" updated`);
      } else {
        await createAgent(payload);
        toast.success(`Agent "${form.id}" created`);
      }
      setDialogOpen(false);
      refetch();
    } catch (err) {
      toast.error(editingId ? 'Failed to update agent' : 'Failed to create agent', {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleToggle(id: string, enabled: boolean) {
    setTogglingId(id);
    try {
      await toggleAgent(id, enabled);
      toast.success(`Agent "${id}" ${enabled ? 'enabled' : 'disabled'}`);
      refetch();
    } catch (err) {
      toast.error(`Failed to toggle agent: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setTogglingId(null);
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm(`Delete agent "${id}"? This cannot be undone.`)) return;

    try {
      await deleteAgent(id);
      toast.success(`Agent "${id}" deleted`);
      refetch();
    } catch (err) {
      toast.error('Failed to delete agent', {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Loading agents...
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

  const agents = data?.agents ?? [];

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Agents</h1>
        <div className="flex gap-2">
          <Button size="sm" onClick={openCreate}>
            <Plus className="mr-1.5 h-3.5 w-3.5" /> New Agent
          </Button>
          <Button variant="outline" size="sm" onClick={refetch}>
            Refresh
          </Button>
        </div>
      </div>

      {agents.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No agents configured. Create one to get started.
        </p>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Models</TableHead>
                <TableHead>Skills</TableHead>
                <TableHead>Tools</TableHead>
                <TableHead>MCPs</TableHead>
                <TableHead>Enabled</TableHead>
                <TableHead className="w-[120px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {agents.map((agent) => {
                const id = String(agent.id ?? '');
                const models = Array.isArray(agent.models)
                  ? agent.models.map((m: any) => typeof m === 'string' ? m : m.model)
                  : [];
                const skills = Array.isArray(agent.skills)
                  ? (agent.skills as string[])
                  : [];
                const tools = Array.isArray(agent.tools)
                  ? (agent.tools as string[])
                  : [];
                const mcpServers = Array.isArray(agent.mcpServers)
                  ? (agent.mcpServers as string[])
                  : [];
                const enabled = Boolean(agent.enabled);

                return (
                  <TableRow key={id}>
                    <TableCell className="font-mono text-sm">{id}</TableCell>
                    <TableCell>{String(agent.name ?? '-')}</TableCell>
                    <TableCell className="max-w-[200px] truncate">
                      {String(agent.description ?? '-')}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {models.map((m) => (
                          <Badge key={String(m)} variant="outline">
                            {String(m)}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {skills.map((s) => (
                          <Badge key={String(s)} variant="secondary">
                            {String(s)}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-muted-foreground">{tools.length}</span>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {mcpServers.map((s) => (
                          <Badge key={String(s)} variant="outline">
                            {String(s)}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={enabled}
                        disabled={togglingId === id || id === 'skill-creator-agent'}
                        onCheckedChange={(checked) => handleToggle(id, checked)}
                      />
                    </TableCell>
                    <TableCell>
                      {id !== 'skill-creator-agent' && (
                        <div className="flex gap-1">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => openEdit(agent)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => handleDelete(id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Create / Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingId ? `Edit Agent: ${editingId}` : 'New Agent'}
            </DialogTitle>
          </DialogHeader>
          <div className="min-h-0 space-y-4 overflow-y-auto py-2 pr-1">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="agent-id">ID</Label>
                <Input
                  id="agent-id"
                  value={form.id}
                  onChange={(e) => setForm((prev) => ({ ...prev, id: e.target.value }))}
                  disabled={!!editingId}
                  placeholder="my-agent"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="agent-name">Name</Label>
                <Input
                  id="agent-name"
                  value={form.name}
                  onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder="My Agent"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="agent-desc">Description</Label>
              <Input
                id="agent-desc"
                value={form.description}
                onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
                placeholder="What this agent does"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="agent-prompt">System Prompt</Label>
              <Textarea
                id="agent-prompt"
                value={form.systemPrompt}
                onChange={(e) => setForm((prev) => ({ ...prev, systemPrompt: e.target.value }))}
                placeholder="You are a helpful assistant..."
                rows={4}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <MultiSelect
                label="Models"
                selected={form.models}
                options={['auto', ...availableModels]}
                onChange={(models) => setForm((prev) => ({ ...prev, models }))}
              />
              <MultiSelect
                label="Skills"
                selected={form.skills}
                options={availableSkills}
                onChange={(skills) => setForm((prev) => ({ ...prev, skills }))}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <MultiSelect
                label="Tools"
                selected={form.tools}
                options={availableTools}
                onChange={(tools) => setForm((prev) => ({ ...prev, tools }))}
              />
              <MultiSelect
                label="MCP Servers"
                selected={form.mcpServers}
                options={availableMcpServers}
                onChange={(mcpServers) => setForm((prev) => ({ ...prev, mcpServers }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="agent-max-iterations">Max Iterations</Label>
              <Input
                id="agent-max-iterations"
                type="number"
                min={1}
                value={form.maxIterations}
                onChange={(e) => setForm((prev) => ({ ...prev, maxIterations: Math.max(1, parseInt(e.target.value, 10) || 1) }))}
                className="sm:max-w-[200px]"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={submitting}>
              {submitting
                ? 'Saving...'
                : editingId
                  ? 'Update'
                  : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
