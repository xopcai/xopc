import { RefreshCw, ShieldOff } from 'lucide-react';
import { useMemo, useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { SettingsPageSkeleton } from '@/features/settings/settings-loading-skeleton';
import { SettingsPageFrame, SettingsPageHeader } from '@/features/settings/settings-page-layout';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { useLocaleStore } from '@/stores/locale-store';
import {
  endpointInvocationsKey,
  endpointPrincipalsKey,
  fetchEndpointInvocations,
  fetchEndpointPrincipals,
  revokeManagedEndpointPrincipal,
  type ManagedEndpointPrincipal,
} from './management-api';
import { MobileDeviceAccessSection } from './mobile-device-access-section';

const REFRESH_INTERVAL_MS = 5_000;

function statusClass(status: 'online' | 'offline' | 'revoked' | 'running' | 'succeeded' | 'failed') {
  if (status === 'online' || status === 'succeeded') return 'bg-success-soft text-success';
  if (status === 'running') return 'bg-accent-soft text-accent-fg';
  if (status === 'failed' || status === 'revoked') return 'bg-danger-soft text-danger';
  return 'bg-surface-hover text-fg-muted';
}

function StatusBadge({ status, label }: { status: Parameters<typeof statusClass>[0]; label: string }) {
  return <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', statusClass(status))}>{label}</span>;
}

export function EndpointToolsManagementSettings() {
  const language = useLocaleStore((state) => state.language);
  const copy = messages(language).endpointToolsSettings;
  const principals = useSWR(endpointPrincipalsKey(), fetchEndpointPrincipals, {
    refreshInterval: REFRESH_INTERVAL_MS,
  });
  const invocations = useSWR(endpointInvocationsKey(), fetchEndpointInvocations, {
    refreshInterval: REFRESH_INTERVAL_MS,
  });
  const [revokeCandidate, setRevokeCandidate] = useState<ManagedEndpointPrincipal>();
  const [revoking, setRevoking] = useState(false);
  const [revokeError, setRevokeError] = useState(false);
  const formatter = useMemo(
    () => new Intl.DateTimeFormat(language === 'zh' ? 'zh-CN' : 'en', { dateStyle: 'medium', timeStyle: 'short' }),
    [language],
  );

  if ((principals.isLoading && !principals.data) || (invocations.isLoading && !invocations.data)) {
    return <SettingsPageFrame><SettingsPageSkeleton sections={2} /></SettingsPageFrame>;
  }

  const principalRows = principals.data ?? [];
  const invocationRows = invocations.data ?? [];
  const onlineCount = principalRows.reduce((count, principal) => count + principal.endpoints.length, 0);
  const refresh = () => void Promise.all([principals.mutate(), invocations.mutate()]);
  const confirmRevoke = async () => {
    if (!revokeCandidate || revoking) return;
    setRevoking(true);
    setRevokeError(false);
    try {
      await revokeManagedEndpointPrincipal(revokeCandidate.id);
      setRevokeCandidate(undefined);
      await Promise.all([principals.mutate(), invocations.mutate()]);
    } catch {
      setRevokeError(true);
    } finally {
      setRevoking(false);
    }
  };

  return (
    <SettingsPageFrame>
      <SettingsPageHeader
        title={copy.title}
        subtitle={copy.subtitle}
        actions={(
          <Button variant="secondary" onClick={refresh}>
            <RefreshCw className="size-4" aria-hidden />
            {copy.refresh}
          </Button>
        )}
      />

      {(principals.error || invocations.error) ? (
        <div className="rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
          {copy.loadError}
        </div>
      ) : null}

      <MobileDeviceAccessSection />

      <div className="grid gap-3 sm:grid-cols-3">
        {[
          [copy.registered, principalRows.length],
          [copy.online, onlineCount],
          [copy.recentCalls, invocationRows.length],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-xl border border-edge bg-surface-base px-4 py-3">
            <p className="text-xs text-fg-muted">{label}</p>
            <p className="mt-1 text-2xl font-semibold text-fg">{value}</p>
          </div>
        ))}
      </div>

      <section className="rounded-2xl border border-edge bg-surface-base p-4">
        <h2 className="text-sm font-semibold text-fg">{copy.devicesTitle}</h2>
        <p className="mt-1 text-sm text-fg-muted">{copy.devicesHint}</p>
        <div className="mt-4 space-y-3">
          {principalRows.length === 0 ? <p className="text-sm text-fg-muted">{copy.noDevices}</p> : null}
          {principalRows.map((principal) => {
            const status = principal.revokedAt ? 'revoked' : principal.endpoints.length > 0 ? 'online' : 'offline';
            return (
              <article key={principal.id} className="rounded-xl border border-edge-subtle bg-surface-panel p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-medium text-fg">{principal.displayName}</h3>
                      <StatusBadge status={status} label={copy.status[status]} />
                    </div>
                    <p className="mt-1 break-all text-xs text-fg-muted">
                      {principal.kind} · {principal.platform} · {principal.id}
                    </p>
                    <p className="mt-1 text-xs text-fg-subtle">
                      {copy.lastSeen}: {principal.lastSeenAt ? formatter.format(principal.lastSeenAt) : copy.never}
                    </p>
                  </div>
                  {!principal.revokedAt ? (
                    <Button
                      variant="secondary"
                      className="text-danger"
                      onClick={() => {
                        setRevokeError(false);
                        setRevokeCandidate(principal);
                      }}
                    >
                      <ShieldOff className="size-4" aria-hidden />
                      {copy.revoke}
                    </Button>
                  ) : null}
                </div>
                {principal.endpoints.map((endpoint) => (
                  <div key={endpoint.connectionId} className="mt-3 rounded-lg bg-surface-base p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-fg-muted">
                      <span>{endpoint.endpointId}</span>
                      <span>{copy.status[endpoint.availability]} · v{endpoint.appVersion}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {endpoint.tools.map(({ descriptor }) => (
                        <span
                          key={descriptor.name}
                          className="rounded-md border border-edge-subtle bg-surface-panel px-2 py-1 text-xs text-fg-muted"
                          title={descriptor.requiredPermissions.join(', ') || copy.noPermissions}
                        >
                          {descriptor.name}
                          <span className="ml-1 text-fg-subtle">
                            · {descriptor.requiredPermissions.join(', ') || copy.noPermissions}
                          </span>
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </article>
            );
          })}
        </div>
      </section>

      <section className="rounded-2xl border border-edge bg-surface-base p-4">
        <h2 className="text-sm font-semibold text-fg">{copy.callsTitle}</h2>
        <p className="mt-1 text-sm text-fg-muted">{copy.callsHint}</p>
        <div className="mt-4 space-y-2">
          {invocationRows.length === 0 ? <p className="text-sm text-fg-muted">{copy.noCalls}</p> : null}
          {invocationRows.map((invocation) => (
            <div key={invocation.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-edge-subtle bg-surface-panel px-3 py-2.5">
              <div className="min-w-0">
                <p className="break-all text-sm font-medium text-fg">{invocation.toolName}</p>
                <p className="mt-0.5 text-xs text-fg-muted">
                  {formatter.format(invocation.startedAt)} · {invocation.effect} · {invocation.endpointId}
                </p>
                {invocation.errorMessage ? <p className="mt-1 text-xs text-danger">{invocation.errorMessage}</p> : null}
              </div>
              <StatusBadge status={invocation.status} label={copy.status[invocation.status]} />
            </div>
          ))}
        </div>
      </section>

      <ConfirmDialog
        open={Boolean(revokeCandidate)}
        title={copy.revokeTitle}
        description={`${copy.revokeDescription.replace('{{name}}', revokeCandidate?.displayName ?? '')}${revokeError ? `\n\n${copy.revokeError}` : ''}`}
        confirmLabel={revoking ? copy.revoking : copy.revoke}
        cancelLabel={copy.cancel}
        destructive
        onConfirm={() => void confirmRevoke()}
        onCancel={() => { if (!revoking) setRevokeCandidate(undefined); }}
      />
    </SettingsPageFrame>
  );
}
