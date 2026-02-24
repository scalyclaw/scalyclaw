import { cn } from '@/lib/utils';

interface StatusDotProps {
  status: 'connected' | 'connecting' | 'disconnected' | 'healthy' | 'unhealthy';
  className?: string;
}

const colors: Record<string, string> = {
  connected: 'bg-emerald-500',
  healthy: 'bg-emerald-500',
  connecting: 'bg-yellow-500 animate-pulse',
  disconnected: 'bg-red-500',
  unhealthy: 'bg-red-500',
};

export function StatusDot({ status, className }: StatusDotProps) {
  return (
    <span
      className={cn('inline-block h-2 w-2 rounded-full', colors[status] ?? 'bg-zinc-500', className)}
      title={status}
    />
  );
}
