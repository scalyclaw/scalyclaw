import { NavLink } from 'react-router';
import {
  LayoutDashboard,
  BrainCircuit,

  Radio,
  Cpu,
  Wrench,
  Bot,
  FileText,
  KeyRound,
  Plug,
  Clock,
  ShieldCheck,
  BarChart3,
  ScrollText,
  Server,
  ListTodo,
  Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const links = [
  { to: '/', label: 'Overview', icon: LayoutDashboard },
  { to: '/mind', label: 'Mind', icon: BrainCircuit },
  { to: '/usage', label: 'Usage', icon: BarChart3 },
  { to: '/channels', label: 'Channels', icon: Radio },
  { to: '/models', label: 'Models', icon: Cpu },
  { to: '/agents', label: 'Agents', icon: Bot },
  { to: '/skills', label: 'Skills', icon: Wrench },
  { to: '/memory', label: 'Memory', icon: FileText },
  { to: '/vault', label: 'Vault', icon: KeyRound },
  { to: '/mcp', label: 'MCP', icon: Plug },
  { to: '/scheduler', label: 'Scheduler', icon: Clock },
  { to: '/engagement', label: 'Engagement', icon: Zap },
  { to: '/security', label: 'Security', icon: ShieldCheck },
  { to: '/logs', label: 'Logs', icon: ScrollText },
  { to: '/workers', label: 'Workers', icon: Server },
  { to: '/jobs', label: 'Jobs', icon: ListTodo },

];

interface SidebarProps {
  onClose?: () => void;
}

export function Sidebar({ onClose }: SidebarProps) {
  return (
    <aside className="flex h-full w-56 flex-col border-r bg-sidebar-background">
      <div className="flex h-14 items-center gap-2 border-b px-4">
        <img src="/logo.svg" alt="ScalyClaw" className="h-6 w-6 shrink-0" />
        <span className="text-lg font-semibold text-foreground">ScalyClaw</span>
      </div>
      <nav className="flex-1 overflow-y-auto px-2 py-2">
        {links.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            onClick={onClose}
            end={to === '/'}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors border-l-2',
                isActive
                  ? 'border-emerald-500 bg-sidebar-accent text-sidebar-primary'
                  : 'border-transparent text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground',
              )
            }
          >
            <Icon className="h-4 w-4" />
            {label}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
