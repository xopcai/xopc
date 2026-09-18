import { Globe, Network, Server, Shield, Terminal } from 'lucide-react';
import useSWR from 'swr';

import { fetchExposureStatus } from '@/features/remote-access/remote-access-api';
import { useGatewayConfigSwr } from '@/features/gateway/gateway-config-swr';
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
      return 'text-emerald-700 dark:text-emerald-400';
    case 'connecting':
      return 'text-amber-700 dark:text-amber-400';
    default:
      return 'text-fg-muted';
  }
}

function StatusPill({ label, kind }: { label: string; kind: StatusKind }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs font-medium', statusPillClass(kind))}>
      <span
        className={cn(
          'size-1.5 rounded-full bg-fg-subtle/50',
          kind === 'active' && 'bg-emerald-500',
          kind === 'connecting' && 'bg-amber-500',
        )}
        aria-hidden
      />
      {label}
    </span>
  );
}

export function RemoteAccessStatusStrip({ onOpenTab }: { onOpenTab: (tab: RemoteAccessTabId) => void }) {
  const language = useLocaleStore((s) => s.language);
  const g = messages(language).remoteAccess.guide;
  const hasToken = Boolean(useGatewayStore((s) => s.conversationId));

  const { data: exposure } = useSWR(hasToken ? 'exposure-status' : null, fetchExposureStatus, {
    refreshInterval: 30_000,
  });
  const { data: tunnel } = useSWR(hasToken ? 'tunnel-status' : null, fetchTunnelStatus, {
    refreshInterval: 15_000,
  });
  const config = useGatewayConfigSwr(hasToken);

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
  const gatewayConfig = config.data?.payload?.config;
  const reverseProxyActive = Boolean(
    gatewayConfig
    && typeof gatewayConfig === 'object'
    && !Array.isArray(gatewayConfig)
    && (gatewayConfig as { gateway?: { publicUrl?: unknown } }).gateway?.publicUrl,
  );

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
      tab: 'reverse-proxy',
      icon: Shield,
      title: g.reverseProxyCardTitle,
      kind: reverseProxyActive ? 'active' : 'off',
      statusLabel: reverseProxyActive ? g.statusActive : g.statusOff,
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
    <div className="grid gap-1 rounded-xl bg-surface-hover/20 p-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <button
            key={`${item.tab}-${item.title}`}
            type="button"
            onClick={() => onOpenTab(item.tab)}
            className={cn(
              'flex items-start gap-3 rounded-lg bg-surface-base/45 px-2 py-3 text-left transition-colors',
              'hover:bg-surface-hover/30',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
            )}
          >
            <span className="flex size-8 shrink-0 items-center justify-center text-fg-muted">
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
