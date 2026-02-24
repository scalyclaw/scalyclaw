import { useState } from 'react';
import { useConfigSection } from '@/hooks/use-config-section';
import { useApi } from '@/hooks/use-api';
import { getModels, triggerEngagement } from '@/lib/api';
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
import { toast } from 'sonner';

interface EngagementConfig {
  enabled: boolean;
  model: string;
  cronPattern: string;
  idleThresholdMinutes: number;
  cooldownSeconds: number;
  maxPerDay: number;
  quietHours: {
    enabled: boolean;
    start: number;
    end: number;
    timezone: string;
  };
  triggers: {
    undeliveredResults: boolean;
    firedScheduledItems: boolean;
    unansweredMessages: boolean;
  };
}

type EngagementTab = 'general' | 'quiet-hours' | 'triggers';

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

export default function Engagement() {
  const config = useConfigSection<EngagementConfig>('proactive');
  const modelsApi = useApi(getModels);
  const [tab, setTab] = useState<EngagementTab>('general');
  const [triggering, setTriggering] = useState(false);

  if (config.loading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Loading engagement config...
      </div>
    );
  }

  if (!config.section) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Engagement config not available.
      </div>
    );
  }

  const engagement = config.section;
  const models = modelsApi.data?.models ?? [];

  const handleTrigger = async () => {
    setTriggering(true);
    try {
      const result = await triggerEngagement();
      if (result.triggered > 0) {
        toast.success(`Sent ${result.triggered} engagement message(s)`);
      } else if (result.skipped > 0) {
        toast.info(`${result.skipped} channel(s) busy — messages skipped`);
      } else {
        toast.info('No triggers found — no messages sent');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Trigger failed');
    } finally {
      setTriggering(false);
    }
  };

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">Engagement</h1>
          {config.dirty && <Badge variant="secondary">Unsaved</Badge>}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleTrigger}
            disabled={triggering || !engagement.enabled}
          >
            {triggering ? 'Triggering...' : 'Trigger Now'}
          </Button>
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

      <Tabs value={tab} onValueChange={(v) => setTab(v as EngagementTab)}>
        <TabsList>
          <TabsTrigger value="general">
            General
            {engagement.enabled && (
              <span className="ml-1.5 inline-block h-2 w-2 rounded-full bg-emerald-500" />
            )}
          </TabsTrigger>
          <TabsTrigger value="quiet-hours">
            Quiet Hours
            {engagement.quietHours.enabled && (
              <span className="ml-1.5 inline-block h-2 w-2 rounded-full bg-emerald-500" />
            )}
          </TabsTrigger>
          <TabsTrigger value="triggers">
            Triggers
          </TabsTrigger>
        </TabsList>

        {/* General */}
        <TabsContent value="general" className="mt-4">
          <div className="space-y-6">
            <div className="flex items-center gap-3">
              <Switch
                checked={engagement.enabled}
                onCheckedChange={(v) => config.update((c) => { c.enabled = v; })}
              />
              <Label className="text-sm font-medium">
                {engagement.enabled ? 'Enabled' : 'Disabled'}
              </Label>
            </div>

            {engagement.enabled && (
              <div className="space-y-4">
                <Field label="Model" description="Model for generating engagement messages. Leave empty for auto-selection.">
                  <ModelSelect
                    value={engagement.model}
                    onChange={(v) => config.update((c) => { c.model = v; })}
                    models={models}
                  />
                </Field>

                <Field label="Cron Pattern" description="How often to check for engagement triggers (cron syntax).">
                  <Input
                    value={engagement.cronPattern}
                    onChange={(e) => config.update((c) => { c.cronPattern = e.target.value; })}
                    placeholder="*/15 * * * *"
                  />
                </Field>

                <div className="grid gap-4 sm:grid-cols-3">
                  <Field label="Idle Threshold (min)" description="Minutes of inactivity before engagement.">
                    <Input
                      type="number"
                      min="1"
                      value={String(engagement.idleThresholdMinutes)}
                      onChange={(e) => config.update((c) => { c.idleThresholdMinutes = Number(e.target.value); })}
                    />
                  </Field>
                  <Field label="Cooldown (sec)" description="Per-channel cooldown between messages.">
                    <Input
                      type="number"
                      min="0"
                      value={String(engagement.cooldownSeconds)}
                      onChange={(e) => config.update((c) => { c.cooldownSeconds = Number(e.target.value); })}
                    />
                  </Field>
                  <Field label="Max Per Day" description="Per-channel daily message cap.">
                    <Input
                      type="number"
                      min="1"
                      value={String(engagement.maxPerDay)}
                      onChange={(e) => config.update((c) => { c.maxPerDay = Number(e.target.value); })}
                    />
                  </Field>
                </div>
              </div>
            )}
          </div>
        </TabsContent>

        {/* Quiet Hours */}
        <TabsContent value="quiet-hours" className="mt-4">
          <div className="space-y-6">
            <div className="flex items-center gap-3">
              <Switch
                checked={engagement.quietHours.enabled}
                onCheckedChange={(v) => config.update((c) => { c.quietHours.enabled = v; })}
              />
              <Label className="text-sm font-medium">
                {engagement.quietHours.enabled ? 'Enabled' : 'Disabled'}
              </Label>
            </div>
            <p className="text-sm text-muted-foreground">
              Suppress engagement messages during specific hours.
            </p>

            {engagement.quietHours.enabled && (
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Start Hour (0-23)" description="Quiet period start.">
                  <Input
                    type="number"
                    min="0"
                    max="23"
                    value={String(engagement.quietHours.start)}
                    onChange={(e) => config.update((c) => { c.quietHours.start = Number(e.target.value); })}
                  />
                </Field>
                <Field label="End Hour (0-23)" description="Quiet period end.">
                  <Input
                    type="number"
                    min="0"
                    max="23"
                    value={String(engagement.quietHours.end)}
                    onChange={(e) => config.update((c) => { c.quietHours.end = Number(e.target.value); })}
                  />
                </Field>
                <Field label="Timezone" description="IANA timezone (e.g. America/New_York).">
                  <Input
                    value={engagement.quietHours.timezone}
                    onChange={(e) => config.update((c) => { c.quietHours.timezone = e.target.value; })}
                    placeholder="UTC"
                  />
                </Field>
              </div>
            )}
          </div>
        </TabsContent>

        {/* Triggers */}
        <TabsContent value="triggers" className="mt-4">
          <div className="space-y-6">
            <p className="text-sm text-muted-foreground">
              Choose which conditions trigger engagement messages.
            </p>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-sm">Undelivered Results</Label>
                  <p className="text-xs text-muted-foreground">Worker tasks completed after user's last message.</p>
                </div>
                <Switch
                  checked={engagement.triggers.undeliveredResults}
                  onCheckedChange={(v) => config.update((c) => { c.triggers.undeliveredResults = v; })}
                />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-sm">Fired Scheduled Items</Label>
                  <p className="text-xs text-muted-foreground">Reminders/recurring that fired while user was idle.</p>
                </div>
                <Switch
                  checked={engagement.triggers.firedScheduledItems}
                  onCheckedChange={(v) => config.update((c) => { c.triggers.firedScheduledItems = v; })}
                />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-sm">Unanswered Messages</Label>
                  <p className="text-xs text-muted-foreground">Last message is from user with no assistant response.</p>
                </div>
                <Switch
                  checked={engagement.triggers.unansweredMessages}
                  onCheckedChange={(v) => config.update((c) => { c.triggers.unansweredMessages = v; })}
                />
              </div>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
