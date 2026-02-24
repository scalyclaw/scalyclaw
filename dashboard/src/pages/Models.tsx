import { useState } from 'react';
import { Plus, Trash2, Pencil } from 'lucide-react';
import { getModels, testModel, toggleModel } from '@/lib/api';
import { useApi } from '@/hooks/use-api';
import { useConfigSection } from '@/hooks/use-config-section';
import { PROVIDERS } from '@/lib/providers';
import { toast } from 'sonner';
import { Field } from '@/components/shared/ConfigFields';
import { AddModelDialog, AddEmbeddingModelDialog, type ModelEntry, type EmbeddingModelEntry } from '@/components/shared/AddModelDialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ScrollArea } from '@/components/ui/scroll-area';
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

interface ModelsConfig {
  providers: Record<string, { apiKey?: string; baseUrl?: string }>;
  models: ModelEntry[];
  embeddingModels: EmbeddingModelEntry[];
}

// ── Main Page ──

export default function Models() {
  const { data, error, loading, refetch } = useApi(getModels);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [editIndex, setEditIndex] = useState<number | null>(null);
  const [editEmbeddingIndex, setEditEmbeddingIndex] = useState<number | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showAddEmbedding, setShowAddEmbedding] = useState(false);
  const config = useConfigSection<ModelsConfig>('models');

  function removeModel(index: number) {
    const model = config.section?.models[index];
    config.update((c) => {
      c.models.splice(index, 1);
    });
    config.save().then(() => {
      refetch();
      toast.success(`Model "${model?.id || 'model'}" deleted`);
    });
  }

  function removeEmbeddingModel(index: number) {
    const model = config.section?.embeddingModels[index];
    config.update((c) => {
      c.embeddingModels.splice(index, 1);
    });
    config.save().then(() => {
      refetch();
      toast.success(`Embedding model "${model?.id || 'model'}" deleted`);
    });
  }

  async function handleToggle(id: string, enabled: boolean) {
    setTogglingId(id);
    try {
      await toggleModel(id, enabled);
      toast.success(`Model "${id}" ${enabled ? 'enabled' : 'disabled'}`);
      refetch();
    } catch (err) {
      toast.error(`Failed to toggle model: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setTogglingId(null);
    }
  }

  function handleAddModel(
    providerKey: string,
    provConfig: { apiKey: string; baseUrl: string },
    model: ModelEntry,
  ) {
    config.update((c) => {
      if (!c.providers[providerKey]) {
        c.providers[providerKey] = {};
      }
      if (provConfig.apiKey) c.providers[providerKey].apiKey = provConfig.apiKey;
      if (provConfig.baseUrl) c.providers[providerKey].baseUrl = provConfig.baseUrl;
      c.models.push(model);
    });
    config.save().then(() => {
      refetch();
      toast.success(`Model "${model.id}" added`);
    });
  }

  function handleAddEmbeddingModel(
    providerKey: string,
    provConfig: { apiKey: string; baseUrl: string },
    model: EmbeddingModelEntry,
  ) {
    config.update((c) => {
      if (!c.providers[providerKey]) {
        c.providers[providerKey] = {};
      }
      if (provConfig.apiKey) c.providers[providerKey].apiKey = provConfig.apiKey;
      if (provConfig.baseUrl) c.providers[providerKey].baseUrl = provConfig.baseUrl;
      c.embeddingModels.push(model);
    });
    config.save().then(() => {
      refetch();
      toast.success(`Embedding model "${model.id}" added`);
    });
  }

  async function handleTest(id: string) {
    setTestingId(id);
    try {
      const result = await testModel(id);
      if (result.ok) {
        toast.success(`Model "${id}" responded successfully`);
      } else {
        toast.error(`Model "${id}" test failed`, {
          description: result.error,
        });
      }
    } catch (err) {
      toast.error('Failed to test model', {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setTestingId(null);
    }
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Loading models...
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

  const models = data?.models ?? [];
  const embeddingModels = data?.embeddingModels ?? [];
  const editingModel = editIndex !== null ? config.section?.models[editIndex] : null;
  const editingEmbeddingModel = editEmbeddingIndex !== null ? config.section?.embeddingModels[editEmbeddingIndex] : null;

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Models</h1>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => setShowAdd(true)} disabled={config.loading}>
            <Plus className="mr-1.5 h-3.5 w-3.5" /> Add Model
          </Button>
          <Button size="sm" onClick={() => setShowAddEmbedding(true)} disabled={config.loading}>
            <Plus className="mr-1.5 h-3.5 w-3.5" /> Add Embedding Model
          </Button>
          <Button variant="outline" size="sm" onClick={refetch}>
            Refresh
          </Button>
        </div>
      </div>

      <Tabs defaultValue="models">
        <TabsList>
          <TabsTrigger value="models">Models ({models.length})</TabsTrigger>
          <TabsTrigger value="embedding">Embedding Models ({embeddingModels.length})</TabsTrigger>
        </TabsList>

        {/* ── Chat Models Tab ── */}
        <TabsContent value="models">
          <div className="space-y-4">
            {models.length === 0 ? (
              <p className="text-sm text-muted-foreground">No models configured.</p>
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>ID</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Provider</TableHead>
                      <TableHead>Temp</TableHead>
                      <TableHead>Max Tokens</TableHead>
                      <TableHead>Context</TableHead>
                      <TableHead>Priority</TableHead>
                      <TableHead>Weight</TableHead>
                      <TableHead>Input $/M</TableHead>
                      <TableHead>Output $/M</TableHead>
                      <TableHead>Capabilities</TableHead>
                      <TableHead>Enabled</TableHead>
                      <TableHead className="w-[160px]" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {models.map((model, idx) => {
                      const id = String(model.id ?? '');
                      const capabilities = (
                        ['tool', 'image', 'audio', 'video', 'document', 'reasoning'] as const
                      ).filter((cap) => model[`${cap}Enabled`]);
                      const enabled = model.enabled !== false;

                      return (
                        <TableRow key={id}>
                          <TableCell className="font-mono text-sm">{id}</TableCell>
                          <TableCell>{String(model.name ?? '-')}</TableCell>
                          <TableCell>
                            {PROVIDERS[String(model.provider ?? '')]?.label ?? String(model.provider ?? '-')}
                          </TableCell>
                          <TableCell>{model.temperature != null ? String(model.temperature) : '-'}</TableCell>
                          <TableCell>{model.maxTokens != null ? String(model.maxTokens) : '-'}</TableCell>
                          <TableCell>{model.contextWindow != null ? String(model.contextWindow) : '-'}</TableCell>
                          <TableCell>{model.priority != null ? String(model.priority) : '-'}</TableCell>
                          <TableCell>{model.weight != null ? String(model.weight) : '-'}</TableCell>
                          <TableCell>{model.inputPricePerMillion != null ? `$${model.inputPricePerMillion}` : '-'}</TableCell>
                          <TableCell>{model.outputPricePerMillion != null ? `$${model.outputPricePerMillion}` : '-'}</TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              {capabilities.map((cap) => (
                                <Badge key={cap} variant="outline">
                                  {cap}
                                </Badge>
                              ))}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Switch
                              checked={enabled}
                              disabled={togglingId === id}
                              onCheckedChange={(checked) => handleToggle(id, checked)}
                            />
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setEditIndex(idx)}
                                disabled={config.loading}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="destructive"
                                size="sm"
                                onClick={() => removeModel(idx)}
                                disabled={config.loading}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 ml-1"
                                disabled={testingId === id}
                                onClick={() => handleTest(id)}
                              >
                                {testingId === id ? 'Testing...' : 'Test'}
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </TabsContent>

        {/* ── Embedding Models Tab ── */}
        <TabsContent value="embedding">
          <div className="space-y-4">
            {embeddingModels.length === 0 ? (
              <p className="text-sm text-muted-foreground">No embedding models configured.</p>
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>ID</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Provider</TableHead>
                      <TableHead>Dimensions</TableHead>
                      <TableHead>Priority</TableHead>
                      <TableHead>Weight</TableHead>
                      <TableHead>Input $/M</TableHead>
                      <TableHead>Output $/M</TableHead>
                      <TableHead>Enabled</TableHead>
                      <TableHead className="w-[120px]" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {embeddingModels.map((model, idx) => {
                      const id = String(model.id ?? '');
                      const enabled = model.enabled !== false;

                      return (
                        <TableRow key={id}>
                          <TableCell className="font-mono text-sm">{id}</TableCell>
                          <TableCell>{String(model.name ?? '-')}</TableCell>
                          <TableCell>
                            {PROVIDERS[String(model.provider ?? '')]?.label ?? String(model.provider ?? '-')}
                          </TableCell>
                          <TableCell>{model.dimensions != null ? String(model.dimensions) : '-'}</TableCell>
                          <TableCell>{model.priority != null ? String(model.priority) : '-'}</TableCell>
                          <TableCell>{model.weight != null ? String(model.weight) : '-'}</TableCell>
                          <TableCell>{model.inputPricePerMillion != null ? `$${model.inputPricePerMillion}` : '-'}</TableCell>
                          <TableCell>{model.outputPricePerMillion != null ? `$${model.outputPricePerMillion}` : '-'}</TableCell>
                          <TableCell>
                            <Switch
                              checked={enabled}
                              disabled={togglingId === id}
                              onCheckedChange={(checked) => handleToggle(id, checked)}
                            />
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setEditEmbeddingIndex(idx)}
                                disabled={config.loading}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="destructive"
                                size="sm"
                                onClick={() => removeEmbeddingModel(idx)}
                                disabled={config.loading}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* Add model dialog */}
      <AddModelDialog
        open={showAdd}
        onClose={() => setShowAdd(false)}
        onAdd={handleAddModel}
        existingProviders={config.section?.providers ?? {}}
      />

      {/* Add embedding model dialog */}
      <AddEmbeddingModelDialog
        open={showAddEmbedding}
        onClose={() => setShowAddEmbedding(false)}
        onAdd={handleAddEmbeddingModel}
        existingProviders={config.section?.providers ?? {}}
      />

      {/* Edit chat model dialog */}
      <Dialog open={editIndex !== null && !!editingModel} onOpenChange={(open) => { if (!open) { config.reset(); setEditIndex(null); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Configure Model</DialogTitle>
          </DialogHeader>
          {editingModel && (
            <ScrollArea className="min-h-0 flex-1">
              <div className="space-y-4 pr-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="ID">
                    <Input
                      value={editingModel.id}
                      disabled
                      className="bg-muted"
                    />
                  </Field>
                  <Field label="Provider">
                    <Input
                      value={PROVIDERS[editingModel.provider]?.label ?? editingModel.provider}
                      disabled
                      className="bg-muted"
                    />
                  </Field>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="Name">
                    <Input
                      value={editingModel.name}
                      onChange={(e) => config.update((c) => { c.models[editIndex!].name = e.target.value; })}
                    />
                  </Field>
                  <Field label="Temperature">
                    <Input
                      type="number"
                      step="0.1"
                      min="0"
                      max="2"
                      value={String(editingModel.temperature)}
                      onChange={(e) => config.update((c) => { c.models[editIndex!].temperature = Number(e.target.value); })}
                    />
                  </Field>
                  <Field label="Max Tokens">
                    <Input
                      type="number"
                      value={String(editingModel.maxTokens)}
                      onChange={(e) => config.update((c) => { c.models[editIndex!].maxTokens = Number(e.target.value); })}
                    />
                  </Field>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="Context Window">
                    <Input
                      type="number"
                      value={String(editingModel.contextWindow)}
                      onChange={(e) => config.update((c) => { c.models[editIndex!].contextWindow = Number(e.target.value); })}
                    />
                  </Field>
                  <Field label="Priority">
                    <Input
                      type="number"
                      min="1"
                      value={String(editingModel.priority)}
                      onChange={(e) => config.update((c) => { c.models[editIndex!].priority = Number(e.target.value); })}
                    />
                  </Field>
                  <Field label="Weight">
                    <Input
                      type="number"
                      min="0"
                      step="0.1"
                      value={String(editingModel.weight)}
                      onChange={(e) => config.update((c) => { c.models[editIndex!].weight = Number(e.target.value); })}
                    />
                  </Field>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Input $/M tokens">
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={String(editingModel.inputPricePerMillion ?? 0)}
                      onChange={(e) => config.update((c) => { c.models[editIndex!].inputPricePerMillion = Number(e.target.value); })}
                    />
                  </Field>
                  <Field label="Output $/M tokens">
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={String(editingModel.outputPricePerMillion ?? 0)}
                      onChange={(e) => config.update((c) => { c.models[editIndex!].outputPricePerMillion = Number(e.target.value); })}
                    />
                  </Field>
                </div>
                <div className="space-y-2">
                  <Label className="text-sm">Capabilities</Label>
                  <div className="flex flex-wrap gap-4">
                    {(['toolEnabled', 'imageEnabled', 'audioEnabled', 'videoEnabled', 'documentEnabled', 'reasoningEnabled'] as const).map((cap) => (
                      <div key={cap} className="flex items-center gap-2">
                        <Switch
                          checked={editingModel[cap]}
                          onCheckedChange={(checked) =>
                            config.update((c) => { c.models[editIndex!][cap] = checked; })
                          }
                        />
                        <Label className="text-xs">{cap.replace('Enabled', '')}</Label>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </ScrollArea>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { config.reset(); setEditIndex(null); }}>
              Cancel
            </Button>
            <Button
              onClick={async () => {
                await config.save();
                setEditIndex(null);
                refetch();
              }}
              disabled={config.saving || !config.dirty}
            >
              {config.saving ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit embedding model dialog */}
      <Dialog open={editEmbeddingIndex !== null && !!editingEmbeddingModel} onOpenChange={(open) => { if (!open) { config.reset(); setEditEmbeddingIndex(null); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Configure Embedding Model</DialogTitle>
          </DialogHeader>
          {editingEmbeddingModel && (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="ID">
                  <Input
                    value={editingEmbeddingModel.id}
                    disabled
                    className="bg-muted"
                  />
                </Field>
                <Field label="Provider">
                  <Input
                    value={PROVIDERS[editingEmbeddingModel.provider]?.label ?? editingEmbeddingModel.provider}
                    disabled
                    className="bg-muted"
                  />
                </Field>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Name">
                  <Input
                    value={editingEmbeddingModel.name}
                    onChange={(e) => config.update((c) => { c.embeddingModels[editEmbeddingIndex!].name = e.target.value; })}
                  />
                </Field>
                <Field label="Dimensions">
                  <Input
                    type="number"
                    min="1"
                    value={String(editingEmbeddingModel.dimensions)}
                    onChange={(e) => config.update((c) => { c.embeddingModels[editEmbeddingIndex!].dimensions = Number(e.target.value); })}
                  />
                </Field>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Priority">
                  <Input
                    type="number"
                    min="1"
                    value={String(editingEmbeddingModel.priority)}
                    onChange={(e) => config.update((c) => { c.embeddingModels[editEmbeddingIndex!].priority = Number(e.target.value); })}
                  />
                </Field>
                <Field label="Weight">
                  <Input
                    type="number"
                    min="0"
                    step="0.1"
                    value={String(editingEmbeddingModel.weight)}
                    onChange={(e) => config.update((c) => { c.embeddingModels[editEmbeddingIndex!].weight = Number(e.target.value); })}
                  />
                </Field>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Input $/M tokens">
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={String(editingEmbeddingModel.inputPricePerMillion ?? 0)}
                    onChange={(e) => config.update((c) => { c.embeddingModels[editEmbeddingIndex!].inputPricePerMillion = Number(e.target.value); })}
                  />
                </Field>
                <Field label="Output $/M tokens">
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={String(editingEmbeddingModel.outputPricePerMillion ?? 0)}
                    onChange={(e) => config.update((c) => { c.embeddingModels[editEmbeddingIndex!].outputPricePerMillion = Number(e.target.value); })}
                  />
                </Field>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { config.reset(); setEditEmbeddingIndex(null); }}>
              Cancel
            </Button>
            <Button
              onClick={async () => {
                await config.save();
                setEditEmbeddingIndex(null);
                refetch();
              }}
              disabled={config.saving || !config.dirty}
            >
              {config.saving ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
