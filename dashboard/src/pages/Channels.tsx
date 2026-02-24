import { useConfigSection } from '@/hooks/use-config-section';
import { Field } from '@/components/shared/ConfigFields';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type ChannelConfig = Record<string, unknown> & { enabled?: boolean };
type ChannelsConfig = Record<string, ChannelConfig>;

const CHANNEL_TABS = ['telegram', 'discord', 'slack', 'whatsapp', 'signal', 'teams'] as const;
type ChannelName = (typeof CHANNEL_TABS)[number];

const CHANNEL_LABELS: Record<ChannelName, string> = {
  telegram: 'Telegram',
  discord: 'Discord',
  slack: 'Slack',
  whatsapp: 'WhatsApp',
  signal: 'Signal',
  teams: 'Teams',
};

export default function Channels() {
  const config = useConfigSection<ChannelsConfig>('channels');

  if (config.loading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Loading channels...
      </div>
    );
  }

  const channels = config.section ?? {};

  function getChannel(name: ChannelName): ChannelConfig {
    return channels[name] ?? { enabled: false };
  }

  function setField(name: ChannelName, key: string, value: unknown) {
    config.update((draft) => {
      if (!draft[name]) draft[name] = { enabled: false };
      draft[name][key] = value;
    });
  }

  function toggleEnabled(name: ChannelName, enabled: boolean) {
    config.update((draft) => {
      if (!draft[name]) draft[name] = { enabled: false };
      draft[name].enabled = enabled;
    });
  }

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">Channels</h1>
          {config.dirty && <Badge variant="secondary">Unsaved</Badge>}
        </div>
        <Button
          onClick={() => config.save()}
          disabled={config.saving || !config.dirty}
        >
          {config.saving ? 'Saving...' : 'Save'}
        </Button>
      </div>

      <Tabs defaultValue="telegram">
        <TabsList>
          {CHANNEL_TABS.map((name) => (
            <TabsTrigger key={name} value={name}>
              {CHANNEL_LABELS[name]}
              {getChannel(name).enabled && (
                <span className="ml-1.5 inline-block h-2 w-2 rounded-full bg-emerald-500" />
              )}
            </TabsTrigger>
          ))}
        </TabsList>

        {CHANNEL_TABS.map((name) => {
          const ch = getChannel(name);
          const enabled = Boolean(ch.enabled);
          const set = (key: string, value: unknown) => setField(name, key, value);

          return (
            <TabsContent key={name} value={name} className="mt-4">
              <div className="space-y-6">
                <div className="flex items-center gap-3">
                  <Switch
                    checked={enabled}
                    onCheckedChange={(v) => toggleEnabled(name, v)}
                  />
                  <Label className="text-sm font-medium">
                    {enabled ? 'Enabled' : 'Disabled'}
                  </Label>
                </div>

                {enabled && (
                  <ChannelFields name={name} config={ch} set={set} />
                )}
              </div>
            </TabsContent>
          );
        })}
      </Tabs>
    </div>
  );
}

function ChannelFields({
  name,
  config,
  set,
}: {
  name: ChannelName;
  config: ChannelConfig;
  set: (key: string, value: unknown) => void;
}) {
  switch (name) {
    case 'telegram':
      return (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Bot Token">
              <Input
                value={String(config.botToken ?? '')}
                onChange={(e) => set('botToken', e.target.value)}
                placeholder="${TELEGRAM_BOT_TOKEN}"
              />
            </Field>
            <Field label="Allowlist" description="Comma-separated user IDs">
              <Input
                value={Array.isArray(config.allowlist) ? (config.allowlist as string[]).join(', ') : String(config.allowlist ?? '')}
                onChange={(e) => set('allowlist', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))}
              />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="DM Policy">
              <Select value={String(config.dmPolicy ?? 'open')} onValueChange={(v) => set('dmPolicy', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="open">open</SelectItem>
                  <SelectItem value="allowlist">allowlist</SelectItem>
                  <SelectItem value="closed">closed</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Group Policy">
              <Select value={String(config.groupPolicy ?? 'open')} onValueChange={(v) => set('groupPolicy', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="open">open</SelectItem>
                  <SelectItem value="allowlist">allowlist</SelectItem>
                  <SelectItem value="closed">closed</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Text Chunk Limit" description="Max characters per message">
              <Input
                type="number"
                value={String(config.textChunkLimit ?? 4000)}
                onChange={(e) => set('textChunkLimit', Number(e.target.value))}
              />
            </Field>
            <Field label="Media Max MB">
              <Input
                type="number"
                value={String(config.mediaMaxMb ?? 10)}
                onChange={(e) => set('mediaMaxMb', Number(e.target.value))}
              />
            </Field>
          </div>
        </div>
      );

    case 'discord':
      return (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Bot Token">
              <Input
                value={String(config.botToken ?? '')}
                onChange={(e) => set('botToken', e.target.value)}
                placeholder="${DISCORD_BOT_TOKEN}"
              />
            </Field>
            <Field label="Allowlist" description="Comma-separated user/channel IDs">
              <Input
                value={Array.isArray(config.allowlist) ? (config.allowlist as string[]).join(', ') : String(config.allowlist ?? '')}
                onChange={(e) => set('allowlist', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))}
              />
            </Field>
          </div>
          <Field label="Text Chunk Limit" description="Max characters per message (Discord max: 2000)">
            <Input
              type="number"
              value={String(config.textChunkLimit ?? 2000)}
              onChange={(e) => set('textChunkLimit', Number(e.target.value))}
            />
          </Field>
        </div>
      );

    case 'slack':
      return (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Bot Token">
              <Input
                value={String(config.botToken ?? '')}
                onChange={(e) => set('botToken', e.target.value)}
                placeholder="xoxb-..."
              />
            </Field>
            <Field label="App Token">
              <Input
                value={String(config.appToken ?? '')}
                onChange={(e) => set('appToken', e.target.value)}
                placeholder="xapp-..."
              />
            </Field>
          </div>
          <Field label="Text Chunk Limit">
            <Input
              type="number"
              value={String(config.textChunkLimit ?? 4000)}
              onChange={(e) => set('textChunkLimit', Number(e.target.value))}
            />
          </Field>
        </div>
      );

    case 'whatsapp':
      return (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Phone Number ID">
              <Input
                value={String(config.phoneNumberId ?? '')}
                onChange={(e) => set('phoneNumberId', e.target.value)}
              />
            </Field>
            <Field label="Access Token">
              <Input
                value={String(config.accessToken ?? '')}
                onChange={(e) => set('accessToken', e.target.value)}
                placeholder="${WHATSAPP_ACCESS_TOKEN}"
              />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Verify Token">
              <Input
                value={String(config.verifyToken ?? '')}
                onChange={(e) => set('verifyToken', e.target.value)}
              />
            </Field>
            <Field label="API Version">
              <Input
                value={String(config.apiVersion ?? 'v21.0')}
                onChange={(e) => set('apiVersion', e.target.value)}
              />
            </Field>
          </div>
          <Field label="Text Chunk Limit">
            <Input
              type="number"
              value={String(config.textChunkLimit ?? 4000)}
              onChange={(e) => set('textChunkLimit', Number(e.target.value))}
            />
          </Field>
        </div>
      );

    case 'signal':
      return (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="API URL">
              <Input
                value={String(config.apiUrl ?? 'http://localhost:8080')}
                onChange={(e) => set('apiUrl', e.target.value)}
              />
            </Field>
            <Field label="Phone Number">
              <Input
                value={String(config.phoneNumber ?? '')}
                onChange={(e) => set('phoneNumber', e.target.value)}
                placeholder="+1234567890"
              />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Poll Interval (ms)">
              <Input
                type="number"
                value={String(config.pollIntervalMs ?? 2000)}
                onChange={(e) => set('pollIntervalMs', Number(e.target.value))}
              />
            </Field>
            <Field label="Text Chunk Limit">
              <Input
                type="number"
                value={String(config.textChunkLimit ?? 4000)}
                onChange={(e) => set('textChunkLimit', Number(e.target.value))}
              />
            </Field>
          </div>
        </div>
      );

    case 'teams':
      return (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="App ID">
              <Input
                value={String(config.appId ?? '')}
                onChange={(e) => set('appId', e.target.value)}
              />
            </Field>
            <Field label="App Password">
              <Input
                value={String(config.appPassword ?? '')}
                onChange={(e) => set('appPassword', e.target.value)}
                placeholder="${TEAMS_APP_PASSWORD}"
              />
            </Field>
          </div>
          <Field label="Text Chunk Limit">
            <Input
              type="number"
              value={String(config.textChunkLimit ?? 4000)}
              onChange={(e) => set('textChunkLimit', Number(e.target.value))}
            />
          </Field>
        </div>
      );
  }
}
