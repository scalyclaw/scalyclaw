import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { PROVIDERS, PROVIDER_KEYS } from '@/lib/providers';

export interface ModelEntry {
  id: string;
  name: string;
  provider: string;
  temperature: number;
  maxTokens: number;
  contextWindow: number;
  priority: number;
  weight: number;
  toolEnabled: boolean;
  imageEnabled: boolean;
  audioEnabled: boolean;
  videoEnabled: boolean;
  documentEnabled: boolean;
  reasoningEnabled: boolean;
  inputPricePerMillion: number;
  outputPricePerMillion: number;
  enabled: boolean;
}

export interface EmbeddingModelEntry {
  id: string;
  name: string;
  provider: string;
  dimensions: number;
  priority: number;
  weight: number;
  inputPricePerMillion: number;
  outputPricePerMillion: number;
  enabled: boolean;
}

interface AddModelDialogProps {
  open: boolean;
  onClose: () => void;
  onAdd: (provider: string, providerConfig: { apiKey: string; baseUrl: string }, model: ModelEntry) => void;
  existingProviders: Record<string, { apiKey?: string; baseUrl?: string }>;
}

export function AddModelDialog({ open, onClose, onAdd, existingProviders }: AddModelDialogProps) {
  const [providerKey, setProviderKey] = useState('');
  const [selectedModel, setSelectedModel] = useState('');
  const [customModel, setCustomModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(8192);
  const [contextWindow, setContextWindow] = useState(128000);
  const [priority, setPriority] = useState(1);
  const [weight, setWeight] = useState(1);
  const [tool, setTool] = useState(true);
  const [image, setImage] = useState(false);
  const [audio, setAudio] = useState(false);
  const [video, setVideo] = useState(false);
  const [document, setDocument] = useState(false);
  const [reasoning, setReasoning] = useState(false);
  const [inputPrice, setInputPrice] = useState(0);
  const [outputPrice, setOutputPrice] = useState(0);

  const reset = () => {
    setProviderKey('');
    setSelectedModel('');
    setCustomModel('');
    setApiKey('');
    setBaseUrl('');
    setTemperature(0.7);
    setMaxTokens(8192);
    setContextWindow(128000);
    setPriority(1);
    setWeight(1);
    setTool(true);
    setImage(false);
    setAudio(false);
    setVideo(false);
    setDocument(false);
    setReasoning(false);
    setInputPrice(0);
    setOutputPrice(0);
  };

  const selectProvider = (key: string) => {
    setProviderKey(key);
    setSelectedModel('');
    setCustomModel('');
    const info = PROVIDERS[key];
    const existing = existingProviders[key];
    setApiKey(existing?.apiKey ?? '');
    setBaseUrl(existing?.baseUrl ?? info.baseUrl);
  };

  const provider = providerKey ? PROVIDERS[providerKey] : null;
  const isNewProvider = providerKey ? !existingProviders[providerKey] : false;
  const modelName = selectedModel === '__custom__' ? customModel : selectedModel;
  const needsKey = provider?.requiresKey && isNewProvider;

  const canAdd =
    providerKey &&
    modelName.trim() &&
    (!needsKey || apiKey.trim()) &&
    (providerKey !== 'custom' || baseUrl.trim());

  const handleAdd = () => {
    if (!canAdd) return;
    const id = modelName;
    const model: ModelEntry = {
      id,
      name: modelName,
      provider: providerKey,
      temperature,
      maxTokens,
      contextWindow,
      priority,
      weight,
      toolEnabled: tool,
      imageEnabled: image,
      audioEnabled: audio,
      videoEnabled: video,
      documentEnabled: document,
      reasoningEnabled: reasoning,
      inputPricePerMillion: inputPrice,
      outputPricePerMillion: outputPrice,
      enabled: true,
    };
    const provConfig = {
      apiKey: existingProviders[providerKey]?.apiKey || apiKey,
      baseUrl: existingProviders[providerKey]?.baseUrl || baseUrl,
    };
    onAdd(providerKey, provConfig, model);
    reset();
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { reset(); onClose(); } }}>
      <DialogContent className="overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Model</DialogTitle>
        </DialogHeader>

        {/* Step 1: Provider */}
        {!providerKey && (
          <div className="space-y-3">
            <Label>Select Provider</Label>
            <div className="grid grid-cols-2 gap-2">
              {PROVIDER_KEYS.map((key) => (
                <button
                  key={key}
                  onClick={() => selectProvider(key)}
                  className="rounded-lg border border-border p-3 text-left transition-colors hover:border-primary hover:bg-primary/5"
                >
                  <p className="font-medium">{PROVIDERS[key].label}</p>
                  {key !== 'custom' && (
                    <p className="text-xs text-muted-foreground">{PROVIDERS[key].chatModels.length} models</p>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 2+: Provider selected */}
        {providerKey && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Badge variant="secondary">{provider!.label}</Badge>
              <button onClick={() => setProviderKey('')} className="text-xs text-muted-foreground hover:text-foreground">
                change
              </button>
            </div>

            {needsKey && (
              <div className="space-y-3 rounded-lg border border-dashed p-3">
                <p className="text-sm text-muted-foreground">First time using {provider!.label} — enter credentials</p>
                <div className="space-y-2">
                  <Label>API Key</Label>
                  <Input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-..." />
                </div>
                <div className="space-y-2">
                  <Label>Base URL</Label>
                  <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://..." />
                </div>
              </div>
            )}

            {providerKey === 'custom' && !isNewProvider && (
              <div className="space-y-3 rounded-lg border border-dashed p-3">
                <div className="space-y-2">
                  <Label>Base URL</Label>
                  <Input value={baseUrl || existingProviders[providerKey]?.baseUrl || ''} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://..." />
                </div>
              </div>
            )}

            {/* Model selection */}
            <div className="space-y-2">
              <Label>Model</Label>
              {provider!.chatModels.length > 0 && (
                <div className="space-y-1.5">
                  {provider!.chatModels.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => { setSelectedModel(m.id); setInputPrice(m.inputPrice ?? 0); setOutputPrice(m.outputPrice ?? 0); }}
                      className={cn(
                        'flex w-full items-center justify-between rounded-md border px-3 py-2 text-sm transition-colors',
                        selectedModel === m.id ? 'border-primary bg-primary/5' : 'border-border hover:border-muted-foreground/50',
                      )}
                    >
                      <span className="font-medium">{m.id}</span>
                      <span className="text-xs text-muted-foreground">{m.hint}</span>
                    </button>
                  ))}
                  <button
                    onClick={() => setSelectedModel('__custom__')}
                    className={cn(
                      'flex w-full items-center rounded-md border px-3 py-2 text-sm transition-colors',
                      selectedModel === '__custom__' ? 'border-primary bg-primary/5' : 'border-border hover:border-muted-foreground/50',
                    )}
                  >
                    Custom model name
                  </button>
                </div>
              )}
              {(selectedModel === '__custom__' || provider!.chatModels.length === 0) && (
                <Input
                  value={customModel}
                  onChange={(e) => { setCustomModel(e.target.value); if (provider!.chatModels.length === 0) setSelectedModel('__custom__'); }}
                  placeholder="Enter model name"
                  className="mt-1.5"
                />
              )}
            </div>

            {/* Parameters */}
            {modelName && (
              <div className="space-y-4 border-t pt-4">
                <Label>Parameters</Label>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Temperature</Label>
                    <Input type="number" step="0.1" min="0" max="2" value={temperature} onChange={(e) => setTemperature(Number(e.target.value))} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Max Tokens</Label>
                    <Input type="number" step="1024" min="256" value={maxTokens} onChange={(e) => setMaxTokens(Number(e.target.value))} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Context Window</Label>
                    <Input type="number" step="1024" min="1024" value={contextWindow} onChange={(e) => setContextWindow(Number(e.target.value))} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Priority</Label>
                    <Input type="number" min="1" value={priority} onChange={(e) => setPriority(Number(e.target.value))} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Weight</Label>
                    <Input type="number" min="0" step="0.1" value={weight} onChange={(e) => setWeight(Number(e.target.value))} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Input $/M tokens</Label>
                    <Input type="number" min="0" step="0.01" value={inputPrice} onChange={(e) => setInputPrice(Number(e.target.value))} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Output $/M tokens</Label>
                    <Input type="number" min="0" step="0.01" value={outputPrice} onChange={(e) => setOutputPrice(Number(e.target.value))} />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Capabilities</Label>
                  <div className="flex flex-wrap gap-x-4 gap-y-2">
                    <label className="flex items-center gap-2 text-sm"><Switch checked={tool} onCheckedChange={setTool} /><span>Tool</span></label>
                    <label className="flex items-center gap-2 text-sm"><Switch checked={image} onCheckedChange={setImage} /><span>Image</span></label>
                    <label className="flex items-center gap-2 text-sm"><Switch checked={audio} onCheckedChange={setAudio} /><span>Audio</span></label>
                    <label className="flex items-center gap-2 text-sm"><Switch checked={video} onCheckedChange={setVideo} /><span>Video</span></label>
                    <label className="flex items-center gap-2 text-sm"><Switch checked={document} onCheckedChange={setDocument} /><span>Document</span></label>
                    <label className="flex items-center gap-2 text-sm"><Switch checked={reasoning} onCheckedChange={setReasoning} /><span>Reasoning</span></label>
                  </div>
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => { reset(); onClose(); }}>Cancel</Button>
              <Button onClick={handleAdd} disabled={!canAdd}>Add Model</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Add Embedding Model Dialog ──

interface AddEmbeddingModelDialogProps {
  open: boolean;
  onClose: () => void;
  onAdd: (provider: string, providerConfig: { apiKey: string; baseUrl: string }, model: EmbeddingModelEntry) => void;
  existingProviders: Record<string, { apiKey?: string; baseUrl?: string }>;
}

export function AddEmbeddingModelDialog({ open, onClose, onAdd, existingProviders }: AddEmbeddingModelDialogProps) {
  const [providerKey, setProviderKey] = useState('');
  const [selectedModel, setSelectedModel] = useState('');
  const [customModel, setCustomModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [dimensions, setDimensions] = useState(1536);
  const [priority, setPriority] = useState(1);
  const [weight, setWeight] = useState(1);
  const [embInputPrice, setEmbInputPrice] = useState(0);
  const [embOutputPrice, setEmbOutputPrice] = useState(0);

  const reset = () => {
    setProviderKey('');
    setSelectedModel('');
    setCustomModel('');
    setApiKey('');
    setBaseUrl('');
    setDimensions(1536);
    setPriority(1);
    setWeight(1);
    setEmbInputPrice(0);
    setEmbOutputPrice(0);
  };

  const providersWithEmbeddings = PROVIDER_KEYS.filter(
    (key) => key === 'custom' || PROVIDERS[key].embeddingModels.length > 0,
  );

  const selectProvider = (key: string) => {
    setProviderKey(key);
    setSelectedModel('');
    setCustomModel('');
    const info = PROVIDERS[key];
    const existing = existingProviders[key];
    setApiKey(existing?.apiKey ?? '');
    setBaseUrl(existing?.baseUrl ?? info.baseUrl);
  };

  const provider = providerKey ? PROVIDERS[providerKey] : null;
  const isNewProvider = providerKey ? !existingProviders[providerKey] : false;
  const modelName = selectedModel === '__custom__' ? customModel : selectedModel;
  const needsKey = provider?.requiresKey && isNewProvider;

  const canAdd =
    providerKey &&
    modelName.trim() &&
    (!needsKey || apiKey.trim()) &&
    (providerKey !== 'custom' || baseUrl.trim());

  // Pre-fill dimensions and pricing from catalog when a model is selected
  const handleSelectModel = (modelId: string) => {
    setSelectedModel(modelId);
    if (modelId !== '__custom__' && provider) {
      const catalogEntry = provider.embeddingModels.find((m) => m.id === modelId);
      if (catalogEntry) {
        setDimensions(catalogEntry.dimensions);
        setEmbInputPrice(catalogEntry.inputPrice ?? 0);
        setEmbOutputPrice(catalogEntry.outputPrice ?? 0);
      }
    }
  };

  const handleAdd = () => {
    if (!canAdd) return;
    const id = modelName;
    const model: EmbeddingModelEntry = {
      id,
      name: modelName,
      provider: providerKey,
      dimensions,
      priority,
      weight,
      inputPricePerMillion: embInputPrice,
      outputPricePerMillion: embOutputPrice,
      enabled: true,
    };
    const provConfig = {
      apiKey: existingProviders[providerKey]?.apiKey || apiKey,
      baseUrl: existingProviders[providerKey]?.baseUrl || baseUrl,
    };
    onAdd(providerKey, provConfig, model);
    reset();
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { reset(); onClose(); } }}>
      <DialogContent className="overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Embedding Model</DialogTitle>
        </DialogHeader>

        {/* Step 1: Provider */}
        {!providerKey && (
          <div className="space-y-3">
            <Label>Select Provider</Label>
            <div className="grid grid-cols-2 gap-2">
              {providersWithEmbeddings.map((key) => (
                <button
                  key={key}
                  onClick={() => selectProvider(key)}
                  className="rounded-lg border border-border p-3 text-left transition-colors hover:border-primary hover:bg-primary/5"
                >
                  <p className="font-medium">{PROVIDERS[key].label}</p>
                  {key !== 'custom' && (
                    <p className="text-xs text-muted-foreground">{PROVIDERS[key].embeddingModels.length} models</p>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 2+: Provider selected */}
        {providerKey && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Badge variant="secondary">{provider!.label}</Badge>
              <button onClick={() => setProviderKey('')} className="text-xs text-muted-foreground hover:text-foreground">
                change
              </button>
            </div>

            {needsKey && (
              <div className="space-y-3 rounded-lg border border-dashed p-3">
                <p className="text-sm text-muted-foreground">First time using {provider!.label} — enter credentials</p>
                <div className="space-y-2">
                  <Label>API Key</Label>
                  <Input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-..." />
                </div>
                <div className="space-y-2">
                  <Label>Base URL</Label>
                  <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://..." />
                </div>
              </div>
            )}

            {providerKey === 'custom' && !isNewProvider && (
              <div className="space-y-3 rounded-lg border border-dashed p-3">
                <div className="space-y-2">
                  <Label>Base URL</Label>
                  <Input value={baseUrl || existingProviders[providerKey]?.baseUrl || ''} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://..." />
                </div>
              </div>
            )}

            {/* Model selection */}
            <div className="space-y-2">
              <Label>Embedding Model</Label>
              {provider!.embeddingModels.length > 0 && (
                <div className="space-y-1.5">
                  {provider!.embeddingModels.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => handleSelectModel(m.id)}
                      className={cn(
                        'flex w-full items-center justify-between rounded-md border px-3 py-2 text-sm transition-colors',
                        selectedModel === m.id ? 'border-primary bg-primary/5' : 'border-border hover:border-muted-foreground/50',
                      )}
                    >
                      <span className="font-medium">{m.id}</span>
                      <span className="text-xs text-muted-foreground">{m.hint}</span>
                    </button>
                  ))}
                  <button
                    onClick={() => handleSelectModel('__custom__')}
                    className={cn(
                      'flex w-full items-center rounded-md border px-3 py-2 text-sm transition-colors',
                      selectedModel === '__custom__' ? 'border-primary bg-primary/5' : 'border-border hover:border-muted-foreground/50',
                    )}
                  >
                    Custom model name
                  </button>
                </div>
              )}
              {(selectedModel === '__custom__' || provider!.embeddingModels.length === 0) && (
                <Input
                  value={customModel}
                  onChange={(e) => { setCustomModel(e.target.value); if (provider!.embeddingModels.length === 0) setSelectedModel('__custom__'); }}
                  placeholder="Enter embedding model name"
                  className="mt-1.5"
                />
              )}
            </div>

            {/* Parameters */}
            {modelName && (
              <div className="space-y-4 border-t pt-4">
                <Label>Parameters</Label>
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Dimensions</Label>
                    <Input type="number" min="1" value={dimensions} onChange={(e) => setDimensions(Number(e.target.value))} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Priority</Label>
                    <Input type="number" min="1" value={priority} onChange={(e) => setPriority(Number(e.target.value))} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Weight</Label>
                    <Input type="number" min="0" step="0.1" value={weight} onChange={(e) => setWeight(Number(e.target.value))} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Input $/M tokens</Label>
                    <Input type="number" min="0" step="0.01" value={embInputPrice} onChange={(e) => setEmbInputPrice(Number(e.target.value))} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Output $/M tokens</Label>
                    <Input type="number" min="0" step="0.01" value={embOutputPrice} onChange={(e) => setEmbOutputPrice(Number(e.target.value))} />
                  </div>
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => { reset(); onClose(); }}>Cancel</Button>
              <Button onClick={handleAdd} disabled={!canAdd}>Add Embedding Model</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
