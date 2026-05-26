import { Globe, Network, Server, Terminal } from 'lucide-react';
import useSWR from 'swr';

import { fetchExposureStatus } from '@/features/remote-access/remote-access-api';
import { fetchTunnelStatus } from '@/features/tunnel/tunnel-api';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

import type { RemoteAccessTabId } from './remote-access-tabs';

type StatusKind = 'active' | 'connecting' | 'off';

function statusPillClass(kind: StatusKind): string {
  switch (kind) {
    case 'active':
      return 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400';
    case 'connecting':
      return 'bg-amber-500/15 text-amber-700 dark:text-amber-400';
    default:
      return 'bg-surface-hover text-fg-muted';
  }
}

function StatusPill({ label, kind }: { label: string; kind: StatusKind }) {
  return (
    <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', statusPillClass(kind))}>
      {label}
    </span>
  );
}

export function RemoteAccessStatusStrip({ onOpenTab }: { onOpenTab: (tab: RemoteAccessTabId) => void }) {
  const language = useLocaleStore((s) => s.language);
  const g = messages(language).remoteAccess.guide;
  const hasToken = Boolean(useGatewayStore((s) => s.token));

  const { data: exposure } = useSWR(hasToken ? 'exposure-status' : null, fetchExposureStatus, {
    refreshInterval: 30_000,
  });
  const { data: tunnel } = useSWR(hasToken ? 'tunnel-status' : null, fetchTunnelStatus, {
    refreshInterval: 15_000,
  });

  if (!hasToken) return null;

  const tailscaleActive = exposure?.tailscale.active === true;
  const tunnelState = tunnel?.state;
  const tunnelActive = tunnel?.enabled && tunnelState === 'connected';
  const tunnelConnecting =
    tunnel?.enabled &&
    (tunnelState === 'connecting' ||
      tunnelState === 'reconnecting' ||
      Boolean(tunnel?.startProgress) ||
      Boolean(tunnel?.frpcDownload));

  const items: Array<{
    tab: RemoteAccessTabId;
    icon: typeof Globe;
    title: string;
    kind: StatusKind;
    statusLabel: string;
  }> = [
    {
      tab: 'tailscale',
      icon: Globe,
      title: g.tailscaleCardTitle,
      kind: tailscaleActive ? 'active' : 'off',
      statusLabel: tailscaleActive ? g.statusActive : g.statusOff,
    },
    {
      tab: 'public',
      icon: Network,
      title: g.publicCardTitle,
      kind: tunnelActive ? 'active' : tunnelConnecting ? 'connecting' : 'off',
      statusLabel: tunnelActive ? g.statusActive : tunnelConnecting ? g.statusConnecting : g.statusOff,
    },
    {
      tab: 'ssh',
      icon: Terminal,
      title: g.sshCardTitle,
      kind: 'off',
      statusLabel: g.sshCardStatus,
    },
    {
      tab: 'lan',
      icon: Server,
      title: g.lanCardTitle,
      kind: 'off',
      statusLabel: g.lanCardStatus,
    },
  ];

  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <button
            key={`${item.tab}-${item.title}`}
            type="button"
            onClick={() => onOpenTab(item.tab)}
            className={cn(
              'flex items-start gap-3 rounded-xl border border-edge-subtle bg-surface-base px-3 py-2.5 text-left transition-colors',
              'hover:border-edge hover:bg-surface-hover/50',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
            )}
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-hover/90 text-fg-muted">
              <Icon className="size-4" strokeWidth={1.75} aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-fg">{item.title}</span>
              <StatusPill label={item.statusLabel} kind={item.kind} />
            </span>
          </button>
        );
      })}
    </div>
  );
}
