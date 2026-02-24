import { Fragment, useState } from 'react';
import {
  getMcpServers,
  createMcpServer,
  updateMcpServer,
  deleteMcpServer,
  reconnectMcpServer,
  toggleMcpServer,
} from '@/lib/api';
import { useApi } from '@/hooks/use-api';
import { ChevronDown, ChevronRight, Pencil, Trash2, Plus, RotateCw, FileJson } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type TransportOption = 'auto' | 'stdio' | 'http' | 'sse';

interface McpForm {
  id: string;
  transport: TransportOption;
  command: string;
  args: string;
  env: string;
  cwd: string;
  url: string;
  headers: string;
  enabled: boolean;
}

const emptyForm: McpForm = {
  id: '',
  transport: 'auto',
  command: '',
  args: '',
  env: '',
  cwd: '',
  url: '',
  headers: '',
  enabled: true,
};

/** Detect effective transport from form fields (used when transport is 'auto'). */
function detectTransport(form: McpForm): 'stdio' | 'http' | 'sse' | undefined {
  if (form.command.trim()) return 'stdio';
  if (form.url.trim()) {
    return form.url.trim().endsWith('/sse') ? 'sse' : 'http';
  }
  return undefined;
}

/** Detect transport from a server config payload. */
function detectTransportFromConfig(server: Record<string, unknown>): TransportOption {
  if (server.transport) return server.transport as TransportOption;
  if (server.command) return 'stdio';
  if (server.url) {
    return String(server.url).endsWith('/sse') ? 'sse' : 'http';
  }
  return 'auto';
}

/** Resolve which transport group fields to show. */
function effectiveTransport(form: McpForm): 'stdio' | 'http' | 'sse' | 'auto' {
  if (form.transport !== 'auto') return form.transport;
  return detectTransport(form) ?? 'auto';
}

function formToPayload(form: McpForm): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    id: form.id.trim(),
  };

  // Only include transport if explicitly set (not auto)
  if (form.transport !== 'auto') {
    payload.transport = form.transport;
  }

  if (!form.enabled) payload.enabled = false;

  const resolved = effectiveTransport(form);

  if (resolved === 'stdio' || form.command.trim()) {
    payload.command = form.command.trim();
    payload.args = form.args.trim() ? form.args.trim().split(/\s+/) : [];
    const env = parseKeyValue(form.env, '=');
    if (Object.keys(env).length > 0) payload.env = env;
    if (form.cwd.trim()) payload.cwd = form.cwd.trim();
  }

  if (resolved === 'http' || resolved === 'sse' || form.url.trim()) {
    payload.url = form.url.trim();
    const headers = parseKeyValue(form.headers, ':');
    if (Object.keys(headers).length > 0) payload.headers = headers;
  }

  return payload;
}

function payloadToForm(id: string, server: Record<string, unknown>): McpForm {
  let envStr = '';
  const env = server.env as Record<string, string> | undefined;
  if (env && typeof env === 'object') {
    envStr = Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n');
  }

  let headersStr = '';
  const headers = server.headers as Record<string, string> | undefined;
  if (headers && typeof headers === 'object') {
    headersStr = Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join('\n');
  }

  return {
    id,
    transport: server.transport ? (server.transport as TransportOption) : 'auto',
    command: String(server.command ?? ''),
    args: Array.isArray(server.args) ? (server.args as string[]).join(' ') : '',
    env: envStr,
    cwd: String(server.cwd ?? ''),
    url: String(server.url ?? ''),
    headers: headersStr,
    enabled: server.enabled !== false,
  };
}

function formToJson(form: McpForm): string {
  return JSON.stringify(formToPayload(form), null, 2);
}

function jsonToForm(json: string): McpForm {
  const obj = JSON.parse(json) as Record<string, unknown>;
  const id = String(obj.id ?? '');
  return payloadToForm(id, obj);
}

/** Parse lines of "key<sep>value" into a Record. */
function parseKeyValue(text: string, sep: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const idx = trimmed.indexOf(sep);
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + sep.length).trim();
    if (key) result[key] = value;
  }
  return result;
}

function statusColor(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'connected') return 'default';
  if (status === 'error') return 'destructive';
  return 'secondary';
}

export default function Mcp() {
  const { data, error, loading, refetch } = useApi(getMcpServers);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<McpForm>(emptyForm);
  const [jsonText, setJsonText] = useState('');
  const [jsonError, setJsonError] = useState('');
  const [activeTab, setActiveTab] = useState<string>('form');
  const [submitting, setSubmitting] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importError, setImportError] = useState('');
  const [importing, setImporting] = useState(false);

  function openCreate() {
    setEditingId(null);
    setForm(emptyForm);
    setJsonText(formToJson(emptyForm));
    setJsonError('');
    setActiveTab('form');
    setDialogOpen(true);
  }

  function openEdit(server: Record<string, unknown>) {
    const id = String(server.id ?? '');
    setEditingId(id);
    const f = payloadToForm(id, server);
    setForm(f);
    setJsonText(formToJson(f));
    setJsonError('');
    setActiveTab('form');
    setDialogOpen(true);
  }

  function handleTabChange(tab: string) {
    if (tab === 'json' && activeTab === 'form') {
      setJsonText(formToJson(form));
      setJsonError('');
    } else if (tab === 'form' && activeTab === 'json') {
      try {
        const parsed = jsonToForm(jsonText);
        setForm(parsed);
        setJsonError('');
      } catch {
        setJsonError('Invalid JSON — fix errors before switching to Form');
        return;
      }
    }
    setActiveTab(tab);
  }

  async function handleSubmit() {
    let payload: Record<string, unknown>;

    if (activeTab === 'json') {
      try {
        payload = JSON.parse(jsonText) as Record<string, unknown>;
      } catch {
        setJsonError('Invalid JSON');
        return;
      }
      if (!payload.id || (!payload.command && !payload.url)) {
        setJsonError('"id" and either "command" or "url" are required');
        return;
      }
    } else {
      if (!form.id.trim()) {
        toast.error('ID is required');
        return;
      }
      if (!form.command.trim() && !form.url.trim()) {
        toast.error('Either Command (stdio) or URL (http/sse) is required');
        return;
      }
      payload = formToPayload(form);
    }

    const id = String(payload.id);
    setSubmitting(true);

    try {
      if (editingId) {
        await updateMcpServer(editingId, payload);
        toast.success(`MCP server "${editingId}" updated`);
      } else {
        await createMcpServer(payload);
        toast.success(`MCP server "${id}" created`);
      }
      setDialogOpen(false);
      refetch();
    } catch (err) {
      toast.error(editingId ? 'Failed to update server' : 'Failed to create server', {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm(`Delete MCP server "${id}"? This cannot be undone.`)) return;

    try {
      await deleteMcpServer(id);
      toast.success(`MCP server "${id}" deleted`);
      refetch();
    } catch (err) {
      toast.error('Failed to delete server', {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function handleReconnect(id: string) {
    try {
      await reconnectMcpServer(id);
      toast.success(`Reconnecting "${id}"...`);
      setTimeout(refetch, 1500);
    } catch (err) {
      toast.error('Failed to reconnect', {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function handleToggle(id: string, enabled: boolean) {
    setTogglingId(id);
    try {
      await toggleMcpServer(id, enabled);
      toast.success(`MCP server "${id}" ${enabled ? 'enabled' : 'disabled'}`);
      refetch();
    } catch (err) {
      toast.error(`Failed to toggle server: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setTogglingId(null);
    }
  }

  function openImport() {
    setImportText('');
    setImportError('');
    setImportOpen(true);
  }

  async function handleImport() {
    let parsed: unknown;
    try {
      parsed = JSON.parse(importText);
    } catch {
      setImportError('Invalid JSON');
      return;
    }

    // Accept { "mcpServers": { ... } } or bare { "ServerName": { command, ... }, ... }
    let serversMap: Record<string, Record<string, unknown>>;
    const obj = parsed as Record<string, unknown>;
    if (obj.mcpServers && typeof obj.mcpServers === 'object' && !Array.isArray(obj.mcpServers)) {
      serversMap = obj.mcpServers as Record<string, Record<string, unknown>>;
    } else {
      // Check if this looks like a bare server map (every value is an object with command or url)
      const allObjects = Object.values(obj).every(v => typeof v === 'object' && v !== null && !Array.isArray(v));
      if (allObjects && Object.keys(obj).length > 0) {
        serversMap = obj as Record<string, Record<string, unknown>>;
      } else {
        setImportError('Expected { "mcpServers": { ... } } or { "ServerName": { command, ... } }');
        return;
      }
    }

    const entries = Object.entries(serversMap);
    if (entries.length === 0) {
      setImportError('No servers found in JSON');
      return;
    }

    setImporting(true);
    setImportError('');

    const created: string[] = [];
    const failed: string[] = [];

    for (const [id, cfg] of entries) {
      try {
        await createMcpServer({ id, ...cfg });
        created.push(id);
      } catch (err) {
        failed.push(`${id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    setImporting(false);

    if (created.length > 0) {
      toast.success(`Imported ${created.length} server${created.length > 1 ? 's' : ''}: ${created.join(', ')}`);
    }
    if (failed.length > 0) {
      toast.error(`Failed to import ${failed.length} server${failed.length > 1 ? 's' : ''}`, {
        description: failed.join('\n'),
      });
    }

    if (created.length > 0) {
      setImportOpen(false);
      refetch();
    }
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Loading MCP servers...
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

  const servers = data?.servers ?? [];
  const resolved = effectiveTransport(form);
  const showStdio = resolved === 'stdio' || resolved === 'auto';
  const showUrl = resolved === 'http' || resolved === 'sse' || resolved === 'auto';

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">MCP Servers</h1>
        <div className="flex gap-2">
          <Button size="sm" onClick={openCreate}>
            <Plus className="mr-1.5 h-3.5 w-3.5" /> Add Server
          </Button>
          <Button variant="outline" size="sm" onClick={openImport}>
            <FileJson className="mr-1.5 h-3.5 w-3.5" /> Import JSON
          </Button>
          <Button variant="outline" size="sm" onClick={refetch}>
            Refresh
          </Button>
        </div>
      </div>

      {servers.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No MCP servers configured. Add one to extend ScalyClaw with external tools.
        </p>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[30px]" />
                <TableHead>ID</TableHead>
                <TableHead className="w-[100px]">Transport</TableHead>
                <TableHead className="w-[100px]">Status</TableHead>
                <TableHead className="w-[80px]">Tools</TableHead>
                <TableHead className="w-[80px]">Enabled</TableHead>
                <TableHead className="w-[140px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {servers.map((srv) => {
                const id = String(srv.id ?? '');
                const status = String(srv.status ?? 'disconnected');
                const transport = String(srv.transport ?? detectTransportFromConfig(srv as Record<string, unknown>));
                const toolCount = Number(srv.toolCount ?? 0);
                const tools = Array.isArray(srv.tools)
                  ? (srv.tools as Array<{ name: string; description: string }>)
                  : [];
                const isExpanded = expandedId === id;

                return (
                  <Fragment key={id}>
                    <TableRow
                      className="cursor-pointer"
                      onClick={() => setExpandedId(isExpanded ? null : id)}
                    >
                      <TableCell className="px-2">
                        {isExpanded
                          ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                          : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                      </TableCell>
                      <TableCell className="font-mono text-sm font-medium">{id}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{transport}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusColor(status)}>{status}</Badge>
                        {srv.error ? (
                          <p className="mt-1 text-xs text-destructive">{String(srv.error)}</p>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <span className="text-sm text-muted-foreground">
                          {toolCount} tool{toolCount !== 1 ? 's' : ''}
                        </span>
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Switch
                          checked={srv.enabled !== false}
                          disabled={togglingId === id}
                          onCheckedChange={(checked) => handleToggle(id, checked)}
                        />
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <div className="flex gap-1">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => openEdit(srv as Record<string, unknown>)}
                            title="Edit"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleReconnect(id)}
                            title="Reconnect"
                          >
                            <RotateCw className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => handleDelete(id)}
                            title="Delete"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                    {isExpanded && (
                      <TableRow key={`${id}-expanded`}>
                        <TableCell />
                        <TableCell colSpan={6}>
                          {tools.length > 0 ? (
                            <div className="space-y-2 py-2">
                              {tools.map((t) => (
                                <div key={t.name} className="flex items-start gap-3 text-sm">
                                  <code className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                                    {t.name}
                                  </code>
                                  <span className="text-muted-foreground">{t.description}</span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="py-2 text-sm text-muted-foreground">
                              No tools discovered. Server may be disconnected or has no tools.
                            </p>
                          )}
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Import JSON dialog */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Import MCP Servers</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <p className="text-sm text-muted-foreground">
              Paste MCP server config JSON. Accepts the standard format:
            </p>
            <Textarea
              value={importText}
              onChange={(e) => {
                setImportText(e.target.value);
                setImportError('');
              }}
              className="font-mono text-sm"
              rows={14}
              placeholder={'{\n  "mcpServers": {\n    "ServerName": {\n      "command": "uvx",\n      "args": ["..."],\n      "env": { "KEY": "value" }\n    }\n  }\n}'}
            />
            {importError && (
              <p className="text-sm text-destructive">{importError}</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)} disabled={importing}>
              Cancel
            </Button>
            <Button onClick={handleImport} disabled={importing || !importText.trim()}>
              {importing ? 'Importing...' : 'Import'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create / Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingId ? `Edit: ${editingId}` : 'Add MCP Server'}
            </DialogTitle>
          </DialogHeader>

          <Tabs value={activeTab} onValueChange={handleTabChange} className="min-h-0 overflow-y-auto">
            <TabsList className="w-full">
              <TabsTrigger value="form" className="flex-1">Form</TabsTrigger>
              <TabsTrigger value="json" className="flex-1">JSON</TabsTrigger>
            </TabsList>

            <TabsContent value="form">
              <div className="space-y-4 py-2">
                <div className="space-y-2">
                  <Label htmlFor="mcp-id">ID</Label>
                  <Input
                    id="mcp-id"
                    value={form.id}
                    onChange={(e) => setForm((f) => ({ ...f, id: e.target.value }))}
                    disabled={!!editingId}
                    placeholder="filesystem"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Transport</Label>
                  <Select
                    value={form.transport}
                    onValueChange={(v) => setForm((f) => ({ ...f, transport: v as TransportOption }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">Auto (recommended)</SelectItem>
                      <SelectItem value="stdio">stdio</SelectItem>
                      <SelectItem value="http">http</SelectItem>
                      <SelectItem value="sse">sse</SelectItem>
                    </SelectContent>
                  </Select>
                  {form.transport === 'auto' && (
                    <p className="text-xs text-muted-foreground">
                      Auto-detected from fields: command → stdio, url → http (or sse if ends with /sse)
                    </p>
                  )}
                </div>

                {showStdio && (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="mcp-command">Command</Label>
                      <Input
                        id="mcp-command"
                        value={form.command}
                        onChange={(e) => setForm((f) => ({ ...f, command: e.target.value }))}
                        placeholder="npx"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="mcp-args">Arguments</Label>
                      <Input
                        id="mcp-args"
                        value={form.args}
                        onChange={(e) => setForm((f) => ({ ...f, args: e.target.value }))}
                        placeholder="-y @modelcontextprotocol/server-filesystem /tmp"
                      />
                      <p className="text-xs text-muted-foreground">Space-separated</p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="mcp-env">Environment Variables</Label>
                      <Textarea
                        id="mcp-env"
                        value={form.env}
                        onChange={(e) => setForm((f) => ({ ...f, env: e.target.value }))}
                        placeholder={"KEY=value\nANOTHER_KEY=value"}
                        rows={3}
                      />
                      <p className="text-xs text-muted-foreground">One per line: KEY=value. Use vault:SECRET_NAME for secrets.</p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="mcp-cwd">Working Directory</Label>
                      <Input
                        id="mcp-cwd"
                        value={form.cwd}
                        onChange={(e) => setForm((f) => ({ ...f, cwd: e.target.value }))}
                        placeholder="/path/to/project"
                      />
                      <p className="text-xs text-muted-foreground">Optional — defaults to ScalyClaw root</p>
                    </div>
                  </>
                )}

                {showUrl && (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="mcp-url">URL</Label>
                      <Input
                        id="mcp-url"
                        value={form.url}
                        onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
                        placeholder="http://localhost:8080/mcp"
                      />
                      {form.transport === 'auto' && form.url.trim() && (
                        <p className="text-xs text-muted-foreground">
                          Detected: {form.url.trim().endsWith('/sse') ? 'sse' : 'http'}
                        </p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="mcp-headers">Headers</Label>
                      <Textarea
                        id="mcp-headers"
                        value={form.headers}
                        onChange={(e) => setForm((f) => ({ ...f, headers: e.target.value }))}
                        placeholder={"Authorization: Bearer sk-...\nX-Custom: value"}
                        rows={3}
                      />
                      <p className="text-xs text-muted-foreground">One per line: Header-Name: value</p>
                    </div>
                  </>
                )}

                <div className="flex items-center gap-2">
                  <Switch
                    id="mcp-enabled"
                    checked={form.enabled}
                    onCheckedChange={(checked) => setForm((f) => ({ ...f, enabled: checked }))}
                  />
                  <Label htmlFor="mcp-enabled">Enabled</Label>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="json">
              <div className="space-y-2 py-2">
                <Textarea
                  value={jsonText}
                  onChange={(e) => {
                    setJsonText(e.target.value);
                    setJsonError('');
                  }}
                  className="font-mono text-sm"
                  rows={12}
                  placeholder='{ "id": "...", "command": "npx", "args": [...] }'
                />
                {jsonError && (
                  <p className="text-sm text-destructive">{jsonError}</p>
                )}
              </div>
            </TabsContent>
          </Tabs>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={submitting}>
              {submitting ? 'Saving...' : editingId ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
