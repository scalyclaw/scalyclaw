import { useEffect } from 'react';
import { getWorkers } from '@/lib/api';
import { useApi } from '@/hooks/use-api';
import { formatDuration, formatDate } from '@/lib/utils';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { RefreshCw } from 'lucide-react';
import { Row } from '@/components/shared/Row';

export default function Workers() {
  const { data, error, loading, refetch } = useApi(getWorkers);

  useEffect(() => {
    const interval = setInterval(refetch, 15_000);
    return () => clearInterval(interval);
  }, [refetch]);

  if (loading) {
    return <div className="flex h-full items-center justify-center text-muted-foreground">Loading workers...</div>;
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <p className="text-sm text-destructive">{error}</p>
        <Button variant="outline" size="sm" onClick={refetch}>Retry</Button>
      </div>
    );
  }

  const workers = (data?.workers ?? []).filter((p) => String(p.type) === 'worker');

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Workers</h1>
        <Button variant="outline" size="sm" onClick={refetch}>
          <RefreshCw className="mr-2 h-3.5 w-3.5" /> Refresh
        </Button>
      </div>

      {workers.length === 0 ? (
        <p className="text-sm text-muted-foreground">No workers registered. Start one with <code className="rounded bg-muted px-1 py-0.5 text-xs">bun run worker:start</code></p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {workers.map((worker, idx) => {
            const hostPort = worker.host && worker.port ? `${worker.host}:${worker.port}` : '-';
            const host = String(worker.hostname ?? '-');
            const startedAt = worker.startedAt ? String(worker.startedAt) : null;
            const uptime = typeof worker.uptime === 'number' ? worker.uptime : null;
            const version = String(worker.version ?? '-');
            const concurrency = worker.concurrency != null ? String(worker.concurrency) : '-';

            return (
              <Card key={worker.id ? String(worker.id) : idx}>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" title="alive" />
                    {host}
                  </CardTitle>
                  <Badge variant="secondary">{hostPort}</Badge>
                </CardHeader>
                <CardContent className="space-y-1 text-sm">
                  {startedAt && <Row label="Started" value={formatDate(startedAt)} />}
                  {uptime != null && <Row label="Uptime" value={formatDuration(uptime)} />}
                  <Row label="Concurrency" value={concurrency} />
                  <Row label="Version" value={version} />
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
