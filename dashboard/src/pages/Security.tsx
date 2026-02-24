import { useState } from 'react';
import { useConfigSection } from '@/hooks/use-config-section';
import { useApi } from '@/hooks/use-api';
import { getModels } from '@/lib/api'
import { Field } from '@/components/shared/ConfigFields';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface GuardsConfig {
  message: {
    enabled: boolean;
    model: string;
    echoGuard: { enabled: boolean; similarityThreshold: number };
    contentGuard: { enabled: boolean };
  };
  skill: { enabled: boolean; model: string };
  agent: { enabled: boolean; model: string };
}

type GuardTab = 'message' | 'skill' | 'agent';

function ModelSelect({
  value,
  onChange,
  disabled,
  models,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  models: Array<Record<string, unknown>>;
}) {
  return (
    <Select
      value={value || '_default'}
      onValueChange={(v) => onChange(v === '_default' ? '' : v)}
      disabled={disabled}
    >
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="_default">Auto (weighted selection)</SelectItem>
        {models.filter((m) => m.enabled).map((m) => (
          <SelectItem key={String(m.id)} value={String(m.id)}>
            {String(m.name || m.id)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export default function Security() {
  const config = useConfigSection<GuardsConfig>('guards');
  const modelsApi = useApi(getModels);
  const [tab, setTab] = useState<GuardTab>('message');

  if (config.loading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Loading security config...
      </div>
    );
  }

  if (!config.section) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Security config not available.
      </div>
    );
  }

  const guards = config.section;
  const models = modelsApi.data?.models ?? [];

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">Security</h1>
          {config.dirty && <Badge variant="secondary">Unsaved</Badge>}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => config.reset()}
            disabled={!config.dirty}
          >
            Discard
          </Button>
          <Button
            size="sm"
            onClick={() => config.save()}
            disabled={config.saving || !config.dirty}
          >
            {config.saving ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as GuardTab)}>
        <TabsList>
          <TabsTrigger value="message">
            Message Guard
            {guards.message.enabled && (
              <span className="ml-1.5 inline-block h-2 w-2 rounded-full bg-emerald-500" />
            )}
          </TabsTrigger>
          <TabsTrigger value="skill">
            Skill Guard
            {guards.skill.enabled && (
              <span className="ml-1.5 inline-block h-2 w-2 rounded-full bg-emerald-500" />
            )}
          </TabsTrigger>
          <TabsTrigger value="agent">
            Agent Guard
            {guards.agent.enabled && (
              <span className="ml-1.5 inline-block h-2 w-2 rounded-full bg-emerald-500" />
            )}
          </TabsTrigger>
        </TabsList>

        {/* Message Guard */}
        <TabsContent value="message" className="mt-4">
          <div className="space-y-6">
            <div className="flex items-center gap-3">
              <Switch
                checked={guards.message.enabled}
                onCheckedChange={(v) => config.update((c) => { c.message.enabled = v; })}
              />
              <Label className="text-sm font-medium">
                {guards.message.enabled ? 'Enabled' : 'Disabled'}
              </Label>
            </div>
            <p className="text-sm text-muted-foreground">
              Two-layer guard applied to incoming user messages.
            </p>

            {guards.message.enabled && (
              <div className="space-y-6">
                <Field label="Guard Model" description="Model used for message guard calls. Leave empty for auto-selection via weighted priority.">
                  <ModelSelect
                    value={guards.message.model}
                    onChange={(v) => config.update((c) => { c.message.model = v; })}
                    models={models}
                  />
                </Field>

                <div className="rounded-md border p-4 space-y-4">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Layer 1: Echo Guard</p>
                  <div className="flex items-center justify-between">
                    <Label className="text-sm">Enable Echo Guard</Label>
                    <Switch
                      checked={guards.message.echoGuard.enabled}
                      onCheckedChange={(v) => config.update((c) => { c.message.echoGuard.enabled = v; })}
                    />
                  </div>
                  <Field label="Similarity Threshold" description="Minimum similarity score (0-1) for the echo test to pass. Default: 0.9">
                    <Input
                      type="number"
                      step="0.05"
                      min="0"
                      max="1"
                      value={String(guards.message.echoGuard.similarityThreshold)}
                      onChange={(e) => config.update((c) => {
                        c.message.echoGuard.similarityThreshold = Number(e.target.value);
                      })}
                      disabled={!guards.message.echoGuard.enabled}
                    />
                  </Field>
                </div>

                <div className="rounded-md border p-4 space-y-4">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Layer 2: Content Guard</p>
                  <div className="flex items-center justify-between">
                    <Label className="text-sm">Enable Content Guard</Label>
                    <Switch
                      checked={guards.message.contentGuard.enabled}
                      onCheckedChange={(v) => config.update((c) => { c.message.contentGuard.enabled = v; })}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Analyzes messages for prompt injection, social engineering, harmful content, obfuscation, and jailbreak attempts.
                  </p>
                </div>
              </div>
            )}
          </div>
        </TabsContent>

        {/* Skill Guard */}
        <TabsContent value="skill" className="mt-4">
          <div className="space-y-6">
            <div className="flex items-center gap-3">
              <Switch
                checked={guards.skill.enabled}
                onCheckedChange={(v) => config.update((c) => { c.skill.enabled = v; })}
              />
              <Label className="text-sm font-medium">
                {guards.skill.enabled ? 'Enabled' : 'Disabled'}
              </Label>
            </div>
            <p className="text-sm text-muted-foreground">
              Scans uploaded skills for malicious code and prompt injection.
            </p>

            {guards.skill.enabled && (
              <div className="space-y-6">
                <Field label="Guard Model" description="Model used for skill guard calls. Leave empty for auto-selection via weighted priority.">
                  <ModelSelect
                    value={guards.skill.model}
                    onChange={(v) => config.update((c) => { c.skill.model = v; })}
                    models={models}
                  />
                </Field>
                <p className="text-xs text-muted-foreground">
                  Checks skill markdown and script contents for destructive commands, data exfiltration, obfuscated payloads, and privilege escalation.
                </p>
              </div>
            )}
          </div>
        </TabsContent>

        {/* Agent Guard */}
        <TabsContent value="agent" className="mt-4">
          <div className="space-y-6">
            <div className="flex items-center gap-3">
              <Switch
                checked={guards.agent.enabled}
                onCheckedChange={(v) => config.update((c) => { c.agent.enabled = v; })}
              />
              <Label className="text-sm font-medium">
                {guards.agent.enabled ? 'Enabled' : 'Disabled'}
              </Label>
            </div>
            <p className="text-sm text-muted-foreground">
              Validates agent system prompts and config on create or update.
            </p>

            {guards.agent.enabled && (
              <div className="space-y-6">
                <Field label="Guard Model" description="Model used for agent guard calls. Leave empty for auto-selection via weighted priority.">
                  <ModelSelect
                    value={guards.agent.model}
                    onChange={(v) => config.update((c) => { c.agent.model = v; })}
                    models={models}
                  />
                </Field>
                <p className="text-xs text-muted-foreground">
                  Audits agent definitions for prompt injection, excessive permissions, data exfiltration, and hidden instruction overrides.
                </p>
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
