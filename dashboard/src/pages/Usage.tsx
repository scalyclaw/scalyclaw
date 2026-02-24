import { useState, useMemo } from 'react';
import { RefreshCw, Settings } from 'lucide-react';
import {
  BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { getUsage, getBudget } from '@/lib/api';
import { useApi } from '@/hooks/use-api';
import { useConfigSection } from '@/hooks/use-config-section';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Field } from '@/components/shared/ConfigFields';
import { ProgressBar } from '@/components/shared/ProgressBar';
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';

interface BudgetConfig {
  monthlyLimit: number;
  dailyLimit: number;
  hardLimit: boolean;
  alertThresholds: number[];
}

const PIE_COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#8b5cf6', '#06b6d4', '#f43f5e'];

const CHART_TOOLTIP_STYLE = {
  contentStyle: { backgroundColor: '#0a0a0a', border: '1px solid #1a1a1a', borderRadius: 8 },
  labelStyle: { color: '#737373' },
  itemStyle: { color: '#e5e5e5' },
};

function fmt(n: number): string {
  return `$${n.toFixed(4)}`;
}

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

type Preset = 'today' | '7d' | '30d' | 'month' | 'all';

function getPresetDates(preset: Preset): { from: string; to: string } {
  const now = new Date();
  const today = toDateStr(now);
  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case '7d': {
      const d = new Date(now);
      d.setDate(d.getDate() - 6);
      return { from: toDateStr(d), to: today };
    }
    case '30d': {
      const d = new Date(now);
      d.setDate(d.getDate() - 29);
      return { from: toDateStr(d), to: today };
    }
    case 'month':
      return { from: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`, to: today };
    case 'all':
      return { from: '', to: '' };
  }
}

export default function Usage() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [activePreset, setActivePreset] = useState<Preset | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  const usage = useApi(
    () => getUsage(from || undefined, to || undefined),
    [from, to],
  );
  const budget = useApi(getBudget);
  const config = useConfigSection<BudgetConfig>('budget');

  function applyPreset(preset: Preset) {
    const { from: f, to: t } = getPresetDates(preset);
    setFrom(f);
    setTo(t);
    setActivePreset(preset);
  }

  function clearDates() {
    setFrom('');
    setTo('');
    setActivePreset(null);
  }

  function refetchAll() {
    usage.refetch();
    budget.refetch();
  }

  const totalCalls = useMemo(() => {
    if (!usage.data) return 0;
    return Object.values(usage.data.byType).reduce((s, t) => s + t.calls, 0);
  }, [usage.data]);

  const pieModelData = useMemo(() => {
    if (!usage.data) return [];
    return usage.data.byModel
      .filter((m) => (m.totalCost ?? 0) > 0)
      .map((m) => ({ name: m.model, value: m.totalCost ?? 0 }));
  }, [usage.data]);

  const pieTypeData = useMemo(() => {
    if (!usage.data) return [];
    return Object.entries(usage.data.byType).map(([type, v]) => ({
      name: type,
      value: v.calls,
    }));
  }, [usage.data]);

  const loading = usage.loading || budget.loading;
  const error = usage.error || budget.error;

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Usage</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowSettings(true)}>
            <Settings className="mr-2 h-3.5 w-3.5" /> Settings
          </Button>
          <Button variant="outline" size="sm" onClick={refetchAll}>
            <RefreshCw className="mr-2 h-3.5 w-3.5" /> Refresh
          </Button>
        </div>
      </div>

      {/* Date filter row */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex gap-1">
          {([
            ['today', 'Today'],
            ['7d', '7d'],
            ['30d', '30d'],
            ['month', 'This Month'],
            ['all', 'All Time'],
          ] as [Preset, string][]).map(([key, label]) => (
            <Button
              key={key}
              variant={activePreset === key ? 'default' : 'outline'}
              size="sm"
              onClick={() => applyPreset(key)}
            >
              {label}
            </Button>
          ))}
        </div>
        <div className="space-y-1">
          <Label className="text-xs">From</Label>
          <Input
            type="date"
            value={from}
            onChange={(e) => { setFrom(e.target.value); setActivePreset(null); }}
            className="w-40"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">To</Label>
          <Input
            type="date"
            value={to}
            onChange={(e) => { setTo(e.target.value); setActivePreset(null); }}
            className="w-40"
          />
        </div>
        {(from || to) && (
          <Button variant="ghost" size="sm" onClick={clearDates}>Clear</Button>
        )}
      </div>

      {loading && <p className="text-sm text-muted-foreground">Loading...</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}

      {/* Budget alerts */}
      {budget.data && budget.data.alerts.length > 0 && (
        <div className="space-y-2">
          {budget.data.alerts.map((alert, i) => (
            <div
              key={i}
              className="rounded-md border border-yellow-600/30 bg-yellow-600/10 px-4 py-2 text-sm text-yellow-200"
            >
              {alert}
            </div>
          ))}
        </div>
      )}

      {(usage.data || budget.data) && (
        <>
          {/* Summary cards */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <Card>
              <CardHeader className="pb-1">
                <CardTitle className="text-sm font-medium text-muted-foreground">Today's Cost</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-2xl font-bold">{fmt(budget.data?.currentDayCost ?? 0)}</p>
                {budget.data && budget.data.dailyLimit > 0 && (
                  <ProgressBar
                    value={budget.data.currentDayCost}
                    max={budget.data.dailyLimit}
                    label={`of $${budget.data.dailyLimit}`}
                  />
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-1">
                <CardTitle className="text-sm font-medium text-muted-foreground">Month Cost</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-2xl font-bold">{fmt(budget.data?.currentMonthCost ?? 0)}</p>
                {budget.data && budget.data.monthlyLimit > 0 && (
                  <ProgressBar
                    value={budget.data.currentMonthCost}
                    max={budget.data.monthlyLimit}
                    label={`of $${budget.data.monthlyLimit}`}
                  />
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-1">
                <CardTitle className="text-sm font-medium text-muted-foreground">Total Cost</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{fmt(usage.data?.totalCost ?? 0)}</p>
                <p className="text-xs text-muted-foreground">selected range</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-1">
                <CardTitle className="text-sm font-medium text-muted-foreground">Input Tokens</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{(usage.data?.totalInputTokens ?? 0).toLocaleString()}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-1">
                <CardTitle className="text-sm font-medium text-muted-foreground">Output Tokens</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{(usage.data?.totalOutputTokens ?? 0).toLocaleString()}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-1">
                <CardTitle className="text-sm font-medium text-muted-foreground">API Calls</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{totalCalls.toLocaleString()}</p>
              </CardContent>
            </Card>
          </div>

          {/* Tables */}
          {usage.data && (
            <Tabs defaultValue="model">
              <TabsList>
                <TabsTrigger value="model">By Model</TabsTrigger>
                <TabsTrigger value="type">By Type</TabsTrigger>
              </TabsList>

              <TabsContent value="model">
                {usage.data.byModel.length > 0 && (
                  <div className="rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Model</TableHead>
                          <TableHead>Provider</TableHead>
                          <TableHead className="text-right">Input Tokens</TableHead>
                          <TableHead className="text-right">Output Tokens</TableHead>
                          <TableHead className="text-right">Input Cost</TableHead>
                          <TableHead className="text-right">Output Cost</TableHead>
                          <TableHead className="text-right">Total Cost</TableHead>
                          <TableHead className="text-right">Calls</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {usage.data.byModel.map((row, i) => (
                          <TableRow key={i}>
                            <TableCell className="font-mono">{row.model}</TableCell>
                            <TableCell>{row.provider}</TableCell>
                            <TableCell className="text-right">{row.inputTokens.toLocaleString()}</TableCell>
                            <TableCell className="text-right">{row.outputTokens.toLocaleString()}</TableCell>
                            <TableCell className="text-right">${(row.inputCost ?? 0).toFixed(4)}</TableCell>
                            <TableCell className="text-right">${(row.outputCost ?? 0).toFixed(4)}</TableCell>
                            <TableCell className="text-right font-medium">${(row.totalCost ?? 0).toFixed(4)}</TableCell>
                            <TableCell className="text-right">{row.calls.toLocaleString()}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="type">
                {Object.keys(usage.data.byType).length > 0 && (
                  <div className="rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Type</TableHead>
                          <TableHead className="text-right">Input Tokens</TableHead>
                          <TableHead className="text-right">Output Tokens</TableHead>
                          <TableHead className="text-right">Calls</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {Object.entries(usage.data.byType).map(([type, row]) => (
                          <TableRow key={type}>
                            <TableCell className="capitalize">{type}</TableCell>
                            <TableCell className="text-right">{row.inputTokens.toLocaleString()}</TableCell>
                            <TableCell className="text-right">{row.outputTokens.toLocaleString()}</TableCell>
                            <TableCell className="text-right">{row.calls.toLocaleString()}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </TabsContent>
            </Tabs>
          )}

          {/* Charts */}
          {usage.data && (
            <div className="grid gap-4 lg:grid-cols-2">
              {/* Daily Cost */}
              {usage.data.byDay.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Daily Cost</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={260}>
                      <BarChart data={usage.data.byDay}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1a1a1a" />
                        <XAxis dataKey="date" tick={{ fill: '#737373', fontSize: 12 }} />
                        <YAxis tick={{ fill: '#737373', fontSize: 12 }} tickFormatter={(v) => `$${v}`} />
                        <Tooltip
                          {...CHART_TOOLTIP_STYLE}
                          formatter={(v: number) => [`$${v.toFixed(4)}`, 'Cost']}
                        />
                        <Bar dataKey="cost" fill="#10b981" radius={[3, 3, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              )}

              {/* Daily Tokens */}
              {usage.data.byDay.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Daily Tokens</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={260}>
                      <BarChart data={usage.data.byDay}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1a1a1a" />
                        <XAxis dataKey="date" tick={{ fill: '#737373', fontSize: 12 }} />
                        <YAxis tick={{ fill: '#737373', fontSize: 12 }} tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v} />
                        <Tooltip
                          {...CHART_TOOLTIP_STYLE}
                          formatter={(v: number, name: string) => [v.toLocaleString(), name === 'inputTokens' ? 'Input' : 'Output']}
                        />
                        <Legend formatter={(v) => v === 'inputTokens' ? 'Input' : 'Output'} />
                        <Bar dataKey="inputTokens" stackId="tokens" fill="#10b981" radius={[0, 0, 0, 0]} />
                        <Bar dataKey="outputTokens" stackId="tokens" fill="#3b82f6" radius={[3, 3, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              )}

              {/* Cost by Model */}
              {pieModelData.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Cost by Model</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={260}>
                      <PieChart>
                        <Pie
                          data={pieModelData}
                          cx="50%"
                          cy="50%"
                          outerRadius={90}
                          dataKey="value"
                          label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                        >
                          {pieModelData.map((_, i) => (
                            <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip
                          {...CHART_TOOLTIP_STYLE}
                          formatter={(v: number) => [`$${v.toFixed(4)}`, 'Cost']}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              )}

              {/* Usage by Type */}
              {pieTypeData.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Usage by Type</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={260}>
                      <PieChart>
                        <Pie
                          data={pieTypeData}
                          cx="50%"
                          cy="50%"
                          outerRadius={90}
                          dataKey="value"
                          label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                        >
                          {pieTypeData.map((_, i) => (
                            <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip
                          {...CHART_TOOLTIP_STYLE}
                          formatter={(v: number) => [v.toLocaleString(), 'Calls']}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </>
      )}

      {/* Budget Settings dialog */}
      <Dialog open={showSettings} onOpenChange={(open) => { if (!open) { config.reset(); setShowSettings(false); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Budget Settings</DialogTitle>
          </DialogHeader>
          {config.section && (
            <div className="space-y-4">
              <Field label="Monthly Limit ($)">
                <Input
                  type="number"
                  min="0"
                  step="1"
                  value={String(config.section.monthlyLimit)}
                  onChange={(e) => config.update((c) => { c.monthlyLimit = Number(e.target.value); })}
                />
                <p className="text-xs text-muted-foreground">0 = no limit</p>
              </Field>
              <Field label="Daily Limit ($)">
                <Input
                  type="number"
                  min="0"
                  step="1"
                  value={String(config.section.dailyLimit)}
                  onChange={(e) => config.update((c) => { c.dailyLimit = Number(e.target.value); })}
                />
                <p className="text-xs text-muted-foreground">0 = no limit</p>
              </Field>
              <div className="flex items-center gap-3">
                <Switch
                  checked={config.section.hardLimit}
                  onCheckedChange={(checked) => config.update((c) => { c.hardLimit = checked; })}
                />
                <Label>Hard Limit (block requests when exceeded)</Label>
              </div>
              <Field label="Alert Thresholds (%)">
                <Input
                  value={config.section.alertThresholds.join(', ')}
                  onChange={(e) => config.update((c) => {
                    c.alertThresholds = e.target.value.split(',').map((s) => Number(s.trim())).filter((n) => !isNaN(n) && n > 0);
                  })}
                />
                <p className="text-xs text-muted-foreground">Comma-separated percentages, e.g. 50, 80, 90</p>
              </Field>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { config.reset(); setShowSettings(false); }}>
              Cancel
            </Button>
            <Button
              onClick={async () => {
                await config.save();
                setShowSettings(false);
                refetchAll();
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
