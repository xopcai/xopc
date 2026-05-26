import { AlertTriangle, Globe, Loader2, Power } from 'lucide-react';

import { CopyTextRow } from '@/components/ui/copy-text-row';
import { Button } from '@/components/ui/button';
import { settingsFormSectionClassName } from '@/features/settings/settings-form-section';
import type { TunnelStatusResponse } from '@/features/tunnel/tunnel-api';
import { TunnelStartProgressPanel } from '@/features/tunnel/tunnel-start-progress';
import { cn } from '@/lib/cn';
import type { TunnelSettingsMessages } from '@/i18n/messages';

function statusLabel(t: TunnelSettingsMessages, status: TunnelStatusResponse): string {
  if (status.state === 'connected') return t.statusConnected;
  if (status.state === 'error') return t.statusError;
  if (status.startProgress?.phase === 'reconnecting_frpc') return t.statusReconnecting;
  if (status.startProgress?.phase === 'provisioning_tls') return t.statusProvisioningTls;
  if (status.startProgress?.phase === 'starting_frpc') return t.statusStartingFrpc;
  if (status.startProgress?.phase === 'registering') return t.statusRegistering;
  if (status.startProgress?.phase === 'preparing_frpc' || status.frpcDownload) return t.statusPreparingFrpc;
  if (status.state === 'connecting' || status.state === 'reconnecting') return t.statusConnecting;
  return t.statusOff;
}

function statusTone(status: TunnelStatusResponse): 'connected' | 'progress' | 'error' | 'off' {
  if (status.state === 'connected') return 'connected';
  if (status.state === 'error') return 'error';
  if (
    status.state === 'connecting' ||
    status.state === 'reconnecting' ||
    status.startProgress ||
    status.frpcDownload
  ) {
    return 'progress';
  }
  return 'off';
}

function toneClasses(tone: ReturnType<typeof statusTone>): string {
  switch (tone) {
    case 'connected':
      return 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400';
    case 'progress':
      return 'bg-amber-500/15 text-amber-700 dark:text-amber-400';
    case 'error':
      return 'bg-red-500/15 text-red-700 dark:text-red-400';
    default:
      return 'bg-surface-hover text-fg-muted';
  }
}

function formatUptime(since: string | null): string {
  if (!since) return '—';
  const ms = Date.now() - new Date(since).getTime();
  if (ms < 0) return '—';
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return `${hrs}h ${rem}m`;
}

type Props = {
  t: TunnelSettingsMessages;
  status: TunnelStatusResponse;
  isLoading: boolean;
  statusErr: unknown;
  starting: boolean;
  stopping: boolean;
  showConsentExpired: boolean;
  copyLabels: { copy: string; copied: string; copyFailed: string };
  startDisabled?: boolean;
  startDisabledReason?: string;
  stepLabel?: string;
  onStart: () => void;
  onStop: () => void;
};

export function TunnelControlCard({
  t,
  status: st,
  isLoading,
  statusErr,
  starting,
  stopping,
  showConsentExpired,
  copyLabels,
  startDisabled = false,
  startDisabledReason,
  stepLabel,
  onStart,
  onStop,
}: Props) {
  const tone = statusTone(st);
  const active = st.enabled || starting;
  const showProgress =
    starting ||
    st.state === 'connecting' ||
    st.state === 'reconnecting' ||
    Boolean(st.startProgress) ||
    Boolean(st.frpcDownload);

  return (
    <section className={cn(settingsFormSectionClassName(), 'space-y-4')}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium',
              toneClasses(tone),
            )}
          >
            <span
              className={cn(
                'size-1.5 rounded-full',
                tone === 'connected' && 'bg-emerald-500',
                tone === 'progress' && 'bg-amber-500 animate-pulse',
                tone === 'error' && 'bg-red-500',
                tone === 'off' && 'bg-fg-subtle',
              )}
              aria-hidden
            />
            {isLoading && !st.enabled ? t.loading : statusLabel(t, st)}
          </span>
          {st.connectedSince && st.state === 'connected' ? (
            <span className="text-xs text-fg-subtle">
              {t.uptime} {formatUptime(st.connectedSince)}
            </span>
          ) : null}
        </div>
        <Globe className="size-4 text-fg-subtle" strokeWidth={1.75} aria-hidden />
      </div>

      {statusErr ? (
        <p className="text-sm text-red-600 dark:text-red-400">
          {statusErr instanceof Error ? statusErr.message : String(statusErr)}
        </p>
      ) : null}

      {showConsentExpired ? (
        <p className="rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-xs text-fg-muted">
          {t.consentExpiredBanner}
        </p>
      ) : null}

      {!active ? (
        <div className="space-y-4">
          {stepLabel ? <p className="text-xs font-medium uppercase tracking-wide text-fg-subtle">{stepLabel}</p> : null}
          <div>
            <h2 className="text-base font-semibold text-fg">{t.emptyStateTitle}</h2>
            <p className="mt-1 text-sm leading-relaxed text-fg-muted">{t.emptyStateBody}</p>
          </div>
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2.5 text-xs text-fg-muted">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <p>{t.riskBannerBody}</p>
          </div>
          {startDisabled && startDisabledReason ? (
            <p className="text-sm text-amber-800 dark:text-amber-200">{startDisabledReason}</p>
          ) : null}
          <Button
            type="button"
            disabled={starting || startDisabled}
            onClick={onStart}
            className="w-full sm:w-auto"
          >
            {starting ? <Loader2 className="size-4 animate-spin" /> : <Power className="size-4" />}
            {t.start}
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          {st.publicUrl ? (
            <div className="rounded-xl border border-edge-subtle bg-surface-panel px-3 py-3">
              <CopyTextRow label={t.publicUrlLabel} text={st.publicUrl} labels={copyLabels} />
            </div>
          ) : null}

          {showProgress ? <TunnelStartProgressPanel status={st} t={t} /> : null}

          {st.lastError && st.state === 'error' ? (
            <p className="text-sm text-red-600 dark:text-red-400">{st.lastError}</p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            {st.enabled ? (
              <Button type="button" variant="secondary" disabled={stopping} onClick={onStop}>
                {stopping ? <Loader2 className="size-4 animate-spin" /> : null}
                {t.stop}
              </Button>
            ) : (
              <Button type="button" disabled={starting} onClick={onStart}>
                {starting ? <Loader2 className="size-4 animate-spin" /> : <Power className="size-4" />}
                {t.start}
              </Button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
