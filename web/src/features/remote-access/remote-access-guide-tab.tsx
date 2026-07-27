import { ChevronRight, Globe, Network, Server, Shield, Terminal } from 'lucide-react';
import useSWR from 'swr';

import { RemoteAccessDocsLink } from '@/features/remote-access/remote-access-docs-link';
import { fetchExposureStatus } from '@/features/remote-access/remote-access-api';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

import { RemoteAccessStatusStrip } from './remote-access-status-strip';
import type { RemoteAccessTabId } from './remote-access-tabs';

type MethodCardProps = {
  title: string;
  description: string;
  recommended?: boolean;
  icon: typeof Globe;
  onOpen: () => void;
  openLabel: string;
  recommendedLabel?: string;
};

function MethodCard({
  title,
  description,
  recommended,
  icon: Icon,
  onOpen,
  openLabel,
  recommendedLabel,
}: MethodCardProps) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'group flex w-full flex-col rounded-2xl bg-surface-base p-4 text-left transition-colors',
        'hover:bg-surface-hover/40',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
      )}
    >
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-hover/90 text-fg-muted">
          <Icon className="size-4" strokeWidth={1.75} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-fg">{title}</h3>
            {recommended && recommendedLabel ? (
              <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent-fg">
                {recommendedLabel}
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-sm leading-relaxed text-fg-muted">{description}</p>
        </div>
        <ChevronRight
          className="mt-0.5 size-4 shrink-0 text-fg-subtle transition-transform group-hover:translate-x-0.5"
          aria-hidden
        />
      </div>
      <span className="mt-3 text-xs font-medium text-accent">{openLabel}</span>
    </button>
  );
}

export function RemoteAccessGuideTab({ onOpenTab }: { onOpenTab: (tab: RemoteAccessTabId) => void }) {
  const language = useLocaleStore((s) => s.language);
  const ra = messages(language).remoteAccess;
  const g = ra.guide;
  const hasToken = Boolean(useGatewayStore((s) => s.token));

  const { data: exposure } = useSWR(hasToken ? 'exposure-status' : null, fetchExposureStatus, {
    refreshInterval: 30_000,
  });

  const conflicts = exposure?.conflicts ?? [];

  if (!hasToken) {
    return <p className="text-sm text-fg-muted">{g.needToken}</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <RemoteAccessStatusStrip onOpenTab={onOpenTab} />

      {conflicts.length > 0 ? (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-fg-muted">
          <p className="font-medium text-fg">{g.conflictsTitle}</p>
          <p className="mt-1">{g.conflictsHint}</p>
          <ul className="mt-2 list-inside list-disc text-xs">
            {conflicts.map((c) => (
              <li key={c.code}>{c.message}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div>
        <h2 className="text-sm font-semibold text-fg">{g.pickMethod}</h2>
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <MethodCard
            icon={Globe}
            title={g.tailscaleCardTitle}
            description={g.tailscaleCardDesc}
            recommended
            recommendedLabel={g.recommended}
            openLabel={g.configure}
            onOpen={() => onOpenTab('tailscale')}
          />
          <MethodCard
            icon={Network}
            title={g.publicCardTitle}
            description={g.publicCardDesc}
            openLabel={g.configure}
            onOpen={() => onOpenTab('public')}
          />
          <MethodCard
            icon={Shield}
            title={g.reverseProxyCardTitle}
            description={g.reverseProxyCardDesc}
            openLabel={g.configure}
            onOpen={() => onOpenTab('reverse-proxy')}
          />
          <MethodCard
            icon={Terminal}
            title={g.sshCardTitle}
            description={g.sshCardDesc}
            openLabel={g.configure}
            onOpen={() => onOpenTab('ssh')}
          />
          <MethodCard
            icon={Server}
            title={g.lanCardTitle}
            description={g.lanCardDesc}
            openLabel={g.configure}
            onOpen={() => onOpenTab('lan')}
          />
        </div>
      </div>

      <p className="text-xs leading-relaxed text-fg-subtle">{g.oneAtATimeHint}</p>

      <div className="rounded-xl bg-surface-base px-4 py-3">
        <h3 className="text-sm font-semibold text-fg">{ra.advanced.proxyTitle}</h3>
        <p className="mt-1 text-sm text-fg-muted">{ra.advanced.proxyBody}</p>
        <RemoteAccessDocsLink language={language} label={ra.advanced.proxyDocs} section="advanced" className="mt-2" />
      </div>

      <RemoteAccessDocsLink language={language} label={g.docsLink} />
    </div>
  );
}
