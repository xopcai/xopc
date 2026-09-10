import { AlertCircle, CheckCircle2, KeyRound, Loader2, RefreshCw, Star, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Select, SelectOption } from '@/components/ui/popover-select';
import type { ConnectorsSettingsMessages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { isElectron } from '@/lib/electron-env';
import { settingsInputFocusClass } from '@/lib/form-field-width';

import {
  getComposioHealth,
  getComposioPolicy,
  getComposioScope,
  getComposioToolkitAuthState,
  getConnectorSyncPolicy,
  listConnectorLearningJobs,
  listComposioConnections,
  listComposioTools,
  listComposioTriggerEvents,
  refreshComposioConnection,
  revokeComposioConnection,
  setComposioScope,
  startAccountLearning,
  startConnectorAuthorization,
  updateComposioConnection,
  updateComposioPolicy,
  updateConnectorConfig,
  updateConnectorSyncPolicy,
  waitForActiveComposioConnection,
  type ComposioConnection,
  type ComposioConnectorHealth,
  type ComposioInstallationPolicy,
  type ComposioScope,
  type ComposioToolkitAuthState,
  type ComposioTool,
  type ComposioTriggerEvent,
  type ConnectorAgentOption,
  type ConnectorInstance,
  type ConnectorLearningJob,
  type ConnectorSyncPolicy,
} from '../connectors-api';
import { groupComposioConnections } from '../composio-connection-groups';
import { formatConnectorMessage } from '../utils/connector-i18n';

const inputClass = cn(
  'w-full rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg',
  'placeholder:text-fg-subtle',
  settingsInputFocusClass,
);

function toolkitFrom(instance: ConnectorInstance): string | null {
  return instance.materialized.type === 'composio' ? instance.materialized.toolkit : null;
}

function scopeLabel(scope: ComposioScope, t: ConnectorsSettingsMessages): string {
  if (scope === 'write') return t.composioScopeWrite;
  if (scope === 'admin') return t.composioScopeAdmin;
  return t.composioScopeRead;
}

function healthMessage(health: ComposioConnectorHealth, activeAccounts: number, t: ConnectorsSettingsMessages): string {
  if (health.status === 'connected') {
    return formatConnectorMessage(t.composioHealthConnected, { count: String(activeAccounts) });
  }
  if (health.status === 'reauthorization_required') return t.composioHealthReconnect;
  if (health.status === 'disconnected') return t.composioHealthDisconnected;
  if (health.errorCode === 'missing_credential') return t.composioHealthMissingCredential;
  if (health.errorCode === 'unauthorized') return t.composioHealthUnauthorized;
  if (health.errorCode === 'forbidden') return t.composioHealthForbidden;
  if (health.errorCode === 'network') return t.composioHealthNetwork;
  if (health.errorCode === 'timeout') return t.composioHealthTimeout;
  return t.composioHealthDegraded;
}

function connectionStatusLabel(status: string, t: ConnectorsSettingsMessages): string {
  if (status === 'active') return t.composioConnectionHealthy;
  if (status === 'pending') return t.composioConnectionPending;
  if (status === 'expired') return t.composioConnectionExpired;
  if (status === 'failed') return t.composioConnectionFailed;
  if (status === 'revoked' || status === 'disabled') return t.composioConnectionRevoked;
  return t.composioConnectionUnknown;
}

function learningStatusLabel(
  learning: ConnectorLearningJob,
  syncPolicy: ConnectorSyncPolicy | undefined,
  t: ConnectorsSettingsMessages,
): string {
  if (learning.status === 'paused') {
    return syncPolicy?.scanEnabled === false
      ? t.connectorLearningPausedByPolicy
      : t.connectorLearningPausedByFailure;
  }
  if (learning.status === 'queued') return t.connectorLearningQueued;
  if (learning.status === 'running') return t.connectorLearningRunning;
  if (learning.status === 'completed') return t.connectorLearningCompleted;
  return t.connectorLearningFailed;
}

export function ComposioConnectorPanel({
  instance,
  t,
  onChanged,
}: {
  instance: ConnectorInstance;
  t: ConnectorsSettingsMessages;
  onChanged?: () => Promise<void>;
}) {
  const toolkit = toolkitFrom(instance);
  const [connections, setConnections] = useState<ComposioConnection[]>([]);
  const [tools, setTools] = useState<ComposioTool[]>([]);
  const [events, setEvents] = useState<ComposioTriggerEvent[]>([]);
  const [policy, setPolicy] = useState<ComposioInstallationPolicy | null>(null);
  const [agents, setAgents] = useState<ConnectorAgentOption[]>([]);
  const [health, setHealth] = useState<ComposioConnectorHealth | null>(null);
  const [authState, setAuthState] = useState<ComposioToolkitAuthState | null>(null);
  const [learningJobs, setLearningJobs] = useState<ConnectorLearningJob[]>([]);
  const [syncPolicies, setSyncPolicies] = useState<Record<string, ConnectorSyncPolicy>>({});
  const [scope, setScope] = useState<ComposioScope>('read');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [diagnosticsUnavailable, setDiagnosticsUnavailable] = useState(false);
  const [revokeAuthorizationId, setRevokeAuthorizationId] = useState<string | null>(null);
  const connectionGroups = useMemo(() => groupComposioConnections(connections), [connections]);

  const loadComposio = useCallback(async () => {
    if (!toolkit || instance.materialized.type !== 'composio' || instance.materialized.role === 'credential') return;
    setLoading(true);
    setError(null);
    try {
      const [nextConnections, nextScope, nextPolicy, nextHealth, nextLearningJobs, nextAuthState] = await Promise.all([
        listComposioConnections(),
        getComposioScope(toolkit),
        getComposioPolicy(toolkit),
        getComposioHealth(toolkit),
        listConnectorLearningJobs(),
        getComposioToolkitAuthState(toolkit),
      ]);
      const [toolsResult, eventsResult] = await Promise.allSettled([
        listComposioTools(toolkit),
        listComposioTriggerEvents(20),
      ]);
      const relevantConnections = nextConnections.filter(
        (connection) => connection.toolkit.toLowerCase() === toolkit.toLowerCase(),
      );
      setConnections(relevantConnections);
      setTools(toolsResult.status === 'fulfilled' ? toolsResult.value : []);
      setEvents(eventsResult.status === 'fulfilled'
        ? eventsResult.value.filter((event) => !event.toolkit || event.toolkit.toLowerCase() === toolkit.toLowerCase())
        : []);
      setDiagnosticsUnavailable(toolsResult.status === 'rejected' || eventsResult.status === 'rejected');
      setScope(nextScope);
      setPolicy(nextPolicy.policy);
      setAgents(nextPolicy.agents);
      setHealth(nextHealth);
      setLearningJobs(nextLearningJobs);
      setAuthState(nextAuthState);

      const accounts = groupComposioConnections(relevantConnections)
        .map((group) => group.primary)
        .filter((connection): connection is ComposioConnection & { accountId: string } => Boolean(connection.accountId));
      const policyResults = await Promise.allSettled(accounts.map(async (connection) => [
        connection.accountId,
        await getConnectorSyncPolicy(connection.accountId),
      ] as const));
      setSyncPolicies(Object.fromEntries(policyResults.flatMap((result) => (
        result.status === 'fulfilled' ? [result.value] : []
      ))));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, [instance.materialized, toolkit]);

  useEffect(() => {
    void loadComposio();
  }, [loadComposio]);

  const authorize = useCallback(async () => {
    if (!toolkit) return;
    setLoading(true);
    setError(null);
    try {
      const result = await startConnectorAuthorization(instance.connectorId);
      if (!result.authorizationUrl) throw new Error('The authorization provider did not return an authorization URL.');
      if (isElectron()) {
        const openResult = await window.electronAPI?.shell?.openExternalUrl(result.authorizationUrl);
        if (!openResult?.ok) throw new Error(openResult?.error ?? 'Could not open the system browser.');
      } else {
        window.open(result.authorizationUrl, '_blank', 'noopener,noreferrer');
      }
      await waitForActiveComposioConnection(toolkit, result.connectionId);
      await Promise.all([onChanged?.(), loadComposio()]);
    } catch (authorizeError) {
      setError(authorizeError instanceof Error ? authorizeError.message : String(authorizeError));
    } finally {
      setLoading(false);
    }
  }, [instance.connectorId, loadComposio, onChanged, toolkit]);

  const updateAuthConfig = useCallback(async (authConfigId: string) => {
    setLoading(true);
    setError(null);
    try {
      await updateConnectorConfig(instance.instanceId, {
        config: { ...(instance.config ?? {}), authConfigId: authConfigId || undefined },
      });
      await Promise.all([onChanged?.(), loadComposio()]);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : String(updateError));
    } finally {
      setLoading(false);
    }
  }, [instance.config, instance.instanceId, loadComposio, onChanged]);

  const updateScope = useCallback(async (nextScope: ComposioScope) => {
    if (!toolkit) return;
    setScope(nextScope);
    setError(null);
    try {
      await setComposioScope(toolkit, nextScope);
    } catch (scopeError) {
      setError(scopeError instanceof Error ? scopeError.message : String(scopeError));
      await loadComposio();
    }
  }, [loadComposio, toolkit]);

  const patchPolicy = useCallback(async (patch: Parameters<typeof updateComposioPolicy>[1]) => {
    if (!toolkit) return;
    setError(null);
    try {
      setPolicy(await updateComposioPolicy(toolkit, patch));
    } catch (policyError) {
      setError(policyError instanceof Error ? policyError.message : String(policyError));
    }
  }, [toolkit]);

  const toggleAgent = useCallback((agentId: string) => {
    if (!policy) return;
    const selected = policy.allowedAgentIds.includes(agentId);
    if (selected && policy.allowedAgentIds.length === 1) return;
    const next = selected
      ? policy.allowedAgentIds.filter((id) => id !== agentId)
      : [...policy.allowedAgentIds, agentId];
    void patchPolicy({ allowedAgentIds: next });
  }, [patchPolicy, policy]);

  const mutateConnection = useCallback(async (operation: () => Promise<unknown>) => {
    setLoading(true);
    setError(null);
    try {
      await operation();
      await loadComposio();
    } catch (connectionError) {
      setError(connectionError instanceof Error ? connectionError.message : String(connectionError));
    } finally {
      setLoading(false);
    }
  }, [loadComposio]);

  if (!toolkit) return null;
  if (instance.materialized.type === 'composio' && instance.materialized.role === 'credential') {
    return <p className="text-sm text-fg-muted">{t.composioApiKeyStored}</p>;
  }

  const activeAccountCount = connectionGroups.filter((group) => group.primary.status === 'active').length;
  const authorizeLabel = activeAccountCount > 0 ? t.composioAddAccount : t.composioConnectAccount;
  const healthy = health?.status === 'connected';
  const requiresAuthConfig = authState?.requiresCustomAuthConfig === true;
  const enabledAuthConfigs = authState?.authConfigs.filter(
    (item) => item.status === 'ENABLED' && item.isEnabledForToolRouter,
  ) ?? [];

  return (
    <div className="space-y-5">
      <section className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <span className={cn(
            'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium',
            healthy
              ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
              : 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
          )}>
            {healthy ? <CheckCircle2 className="size-3.5" /> : <AlertCircle className="size-3.5" />}
            {healthy ? t.connectionReady : health ? t.connectionNeedsSetup : t.connectionChecking}
          </span>
          <p className="mt-2 text-sm text-fg-muted">
            {formatConnectorMessage(t.composioAccountCount, { count: String(connectionGroups.length) })}
          </p>
        </div>
        <Button variant="primary" className="shrink-0" disabled={loading} onClick={() => void authorize()}>
          {loading ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
          {authorizeLabel}
        </Button>
      </section>

      {error ? <p className="rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-600">{error}</p> : null}
      {health && !healthy ? (
        <div className="flex flex-col gap-3 rounded-xl border border-amber-500/25 bg-amber-500/5 p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-amber-800 dark:text-amber-200">{healthMessage(health, activeAccountCount, t)}</p>
          {health.recovery !== 'none' ? (
            <Button variant="secondary" disabled={loading} onClick={() => void (health.recovery === 'retry' ? loadComposio() : authorize())}>
              {health.recovery === 'retry' ? t.composioRetry : t.composioReconnectAccount}
            </Button>
          ) : null}
        </div>
      ) : null}
      {requiresAuthConfig && enabledAuthConfigs.length === 0 ? (
        <p className="rounded-xl border border-amber-500/25 bg-amber-500/5 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
          {t.composioAuthConfigEmpty}
        </p>
      ) : null}

      {policy ? (
        <section className="overflow-hidden rounded-xl border border-edge bg-surface-base">
          <div className="grid gap-3 border-b border-edge-subtle px-4 py-4 sm:grid-cols-[minmax(0,1fr)_15rem] sm:items-start">
            <div>
              <p className="text-sm font-medium text-fg">{t.composioAccessTitle}</p>
              <p className="mt-1 text-xs leading-5 text-fg-muted">
                {scope === 'read' ? t.composioAccessReadHint : scope === 'admin' ? t.composioAccessAdminHint : t.composioAccessWriteHint}
              </p>
            </div>
            <Select value={scope} onChange={(event) => void updateScope(event.currentTarget.value as ComposioScope)}>
              <SelectOption value="read">{t.composioAccessReadOnly}</SelectOption>
              <SelectOption value="write">{t.composioAccessReadWrite}</SelectOption>
              {scope === 'admin' ? <SelectOption value="admin">{t.composioAccessAdminCurrent}</SelectOption> : null}
            </Select>
          </div>
          <div className="grid gap-3 border-b border-edge-subtle px-4 py-4 sm:grid-cols-[minmax(0,1fr)_15rem] sm:items-center">
            <p className="text-sm font-medium text-fg">{t.composioConfirmationPolicy}</p>
            <Select
              value={policy.confirmationPolicy}
              onChange={(event) => void patchPolicy({ confirmationPolicy: event.currentTarget.value as ComposioInstallationPolicy['confirmationPolicy'] })}
            >
              <SelectOption value="writes">{t.composioConfirmWrites}</SelectOption>
              <SelectOption value="always">{t.composioConfirmAlways}</SelectOption>
              {policy.confirmationPolicy === 'never' ? <SelectOption value="never">{t.composioConfirmNever}</SelectOption> : null}
            </Select>
          </div>
          <div className="px-4 py-4">
            <p className="text-sm font-medium text-fg">{t.composioAllowedAgents}</p>
            <p className="mt-1 text-xs text-fg-muted">
              {policy.allowedAgentIds.length ? t.composioAllowedAgentsSelected : t.composioAllowedAgentsAll}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                className={cn(
                  'rounded-full border px-2.5 py-1 text-xs transition-colors',
                  policy.allowedAgentIds.length === 0
                    ? 'border-accent bg-accent/10 text-accent'
                    : 'border-edge bg-surface-panel text-fg-muted hover:text-fg',
                )}
                onClick={() => void patchPolicy({ allowedAgentIds: [] })}
              >
                {t.composioAllowedAgentsAllOption}
              </button>
              {agents.map((agent) => {
                const selected = policy.allowedAgentIds.includes(agent.id);
                return (
                  <button
                    key={agent.id}
                    type="button"
                    className={cn(
                      'rounded-full border px-2.5 py-1 text-xs transition-colors',
                      selected
                        ? 'border-accent bg-accent/10 text-accent'
                        : 'border-edge bg-surface-panel text-fg-muted hover:text-fg',
                    )}
                    onClick={() => toggleAgent(agent.id)}
                  >
                    {agent.name}
                  </button>
                );
              })}
            </div>
          </div>
        </section>
      ) : null}

      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-fg">{t.composioConnectedAccounts}</h3>
            <p className="mt-1 text-xs text-fg-muted">
              {formatConnectorMessage(t.composioAccountCount, { count: String(connectionGroups.length) })}
            </p>
          </div>
          <Button variant="ghost" className="h-8 px-2 text-xs" disabled={loading} onClick={() => void loadComposio()}>
            <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
            {t.refresh}
          </Button>
        </div>
        {connectionGroups.length ? (
          <div className="divide-y divide-edge-subtle overflow-hidden rounded-xl border border-edge bg-surface-base">
            {connectionGroups.map((group) => {
              const connection = group.primary;
              const learning = learningJobs.find((job) => (
                connection.accountId ? job.accountId === connection.accountId : job.connectionId === connection.id
              ));
              const syncPolicy = connection.accountId ? syncPolicies[connection.accountId] : undefined;
              const displayName = connection.alias ?? connection.workspace ?? connection.accountEmail
                ?? connection.username ?? t.composioUnnamedAuthorization;
              return (
                <article key={group.key} className="px-4 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-medium text-fg">{displayName}</p>
                        {connection.isDefault ? (
                          <span className="rounded-full bg-surface-hover px-2 py-0.5 text-[11px] text-fg-muted">{t.composioDefaultAccount}</span>
                        ) : null}
                      </div>
                      <p className={cn(
                        'mt-1 text-xs',
                        connection.status === 'active' ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300',
                      )}>
                        {connectionStatusLabel(connection.status, t)}
                      </p>
                      {learning ? (
                        <p className={cn('mt-1 text-xs', learning.status === 'failed' ? 'text-red-600' : 'text-fg-subtle')}>
                          {formatConnectorMessage(t.connectorLearningStatus, {
                            status: learningStatusLabel(learning, syncPolicy, t),
                            count: String(learning.candidatesCreated),
                          })}
                        </p>
                      ) : null}
                    </div>
                    {connection.status === 'active' ? (
                      <Button
                        variant="secondary"
                        className="h-8 shrink-0 px-2.5 text-xs"
                        disabled={loading}
                        onClick={() => void mutateConnection(async () => {
                          if (!connection.accountId) throw new Error('Connector account is unavailable.');
                          await startAccountLearning(connection.accountId);
                          await onChanged?.();
                        })}
                      >
                        <RefreshCw className="size-3.5" />
                        {t.composioSyncNow}
                      </Button>
                    ) : null}
                  </div>

                  <details className="mt-3 text-xs text-fg-muted">
                    <summary className="w-fit cursor-pointer font-medium hover:text-fg">{t.composioAccountSettings}</summary>
                    <div className="mt-3 space-y-4 rounded-lg bg-surface-panel p-3">
                      {syncPolicy ? (
                        <div className="grid gap-3 sm:grid-cols-2">
                          <label className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={syncPolicy.scanEnabled}
                              disabled={loading}
                              onChange={(event) => void mutateConnection(() => updateConnectorSyncPolicy(
                                connection.accountId!,
                                { scanEnabled: event.currentTarget.checked },
                              ))}
                            />
                            {t.connectorScheduledScan}
                          </label>
                          <label className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={syncPolicy.proactiveEnabled}
                              disabled={loading || !syncPolicy.scanEnabled}
                              onChange={(event) => void mutateConnection(() => updateConnectorSyncPolicy(
                                connection.accountId!,
                                { proactiveEnabled: event.currentTarget.checked },
                              ))}
                            />
                            {t.connectorProactiveUse}
                          </label>
                          {syncPolicy.scanEnabled ? (
                            <label className="sm:col-span-2">
                              {t.connectorScanInterval}
                              <Select
                                className="mt-1"
                                value={String(syncPolicy.intervalMinutes ?? 30)}
                                disabled={loading}
                                onChange={(event) => void mutateConnection(() => updateConnectorSyncPolicy(
                                  connection.accountId!,
                                  { intervalMinutes: Number(event.currentTarget.value) },
                                ))}
                              >
                                <SelectOption value="5">5 {t.connectorMinutes}</SelectOption>
                                <SelectOption value="15">15 {t.connectorMinutes}</SelectOption>
                                <SelectOption value="30">30 {t.connectorMinutes}</SelectOption>
                                <SelectOption value="60">60 {t.connectorMinutes}</SelectOption>
                              </Select>
                            </label>
                          ) : null}
                        </div>
                      ) : null}
                      <label className="block">
                        {t.composioAccountAlias}
                        <input
                          className={cn(inputClass, 'mt-1 h-8 py-1 text-xs')}
                          defaultValue={connection.alias ?? ''}
                          onBlur={(event) => {
                            if (event.currentTarget.value !== (connection.alias ?? '')) {
                              void mutateConnection(() => updateComposioConnection(connection.id, { alias: event.currentTarget.value }));
                            }
                          }}
                        />
                      </label>
                      <div className="space-y-2">
                        {group.authorizations.map((authorization) => (
                          <div key={authorization.id} className="flex items-center justify-between gap-2">
                            <p className="min-w-0 break-all font-mono text-fg-subtle">
                              {t.composioAuthorizationId}: {authorization.providerConnectionId}
                            </p>
                            <Button
                              variant="ghost"
                              className="size-7 shrink-0 p-0 text-danger"
                              title={t.composioRevoke}
                              disabled={loading}
                              onClick={() => setRevokeAuthorizationId(authorization.id)}
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </div>
                        ))}
                      </div>
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          className="size-8 p-0"
                          title={t.composioMakeDefault}
                          disabled={loading || connection.isDefault || connection.status !== 'active'}
                          onClick={() => void mutateConnection(async () => {
                            await updateComposioConnection(connection.id, { isDefault: true });
                            await updateComposioPolicy(toolkit, { selectedConnectionIds: [connection.id] });
                          })}
                        >
                          <Star className={cn('size-4', connection.isDefault && 'fill-current')} />
                        </Button>
                        <Button
                          variant="ghost"
                          className="size-8 p-0"
                          title={t.refresh}
                          disabled={loading}
                          onClick={() => void mutateConnection(() => refreshComposioConnection(connection.id))}
                        >
                          <RefreshCw className="size-4" />
                        </Button>
                      </div>
                    </div>
                  </details>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-edge px-4 py-8 text-center">
            <p className="text-sm text-fg-muted">{t.composioConnectionsEmpty}</p>
          </div>
        )}
      </section>

      <details className="rounded-xl border border-edge bg-surface-base">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-fg-muted hover:text-fg">
          {t.composioAdvancedSettings}
        </summary>
        <div className="space-y-5 border-t border-edge-subtle px-4 py-4">
          {diagnosticsUnavailable ? (
            <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
              {t.composioDiagnosticsUnavailable}
            </p>
          ) : null}
          {authState ? (
            <section>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-medium text-fg">{t.composioAuthConfigTitle}</p>
                  <p className="mt-1 text-xs text-fg-muted">
                    {requiresAuthConfig ? t.composioAuthConfigRequiredHint : t.composioAuthConfigOptionalHint}
                  </p>
                </div>
                <a className="text-xs font-medium text-accent-fg hover:underline" href="https://app.composio.dev" target="_blank" rel="noreferrer">
                  {t.composioAuthConfigManage}
                </a>
              </div>
              <Select
                className="mt-3"
                value={typeof instance.config?.authConfigId === 'string' ? instance.config.authConfigId : ''}
                disabled={loading}
                onChange={(event) => void updateAuthConfig(event.currentTarget.value)}
              >
                {!requiresAuthConfig ? <SelectOption value="">{t.composioAuthConfigManaged}</SelectOption> : null}
                {requiresAuthConfig && typeof instance.config?.authConfigId !== 'string' ? (
                  <SelectOption value="" disabled>{t.composioAuthConfigSelect}</SelectOption>
                ) : null}
                {enabledAuthConfigs.map((item) => (
                  <SelectOption key={item.id} value={item.id}>{item.name} · {item.authScheme ?? 'OAuth'}</SelectOption>
                ))}
              </Select>
            </section>
          ) : null}
          <div className="grid gap-5 sm:grid-cols-2">
            <section>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-subtle">{t.composioAgentTools}</p>
              <div className="space-y-2">
                {tools.length ? tools.slice(0, 8).map((tool) => (
                  <div key={tool.slug} className="rounded-lg bg-surface-panel px-3 py-2">
                    <p className="truncate font-mono text-xs text-fg">{tool.slug}</p>
                    <p className="mt-0.5 text-xs text-fg-subtle">
                      {scopeLabel(tool.scope, t)}{tool.curated ? '' : ` ${t.composioUncuratedSuffix}`}
                    </p>
                  </div>
                )) : <p className="text-xs text-fg-muted">{t.composioToolsEmpty}</p>}
              </div>
            </section>
            <section>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-subtle">{t.composioRecentTriggers}</p>
              <div className="space-y-2">
                {events.length ? events.slice(0, 5).map((event) => (
                  <div key={`${event.id}-${event.at}`} className="rounded-lg bg-surface-panel px-3 py-2">
                    <p className="truncate text-xs text-fg">{event.trigger ?? event.id}</p>
                    <p className="mt-0.5 text-xs text-fg-subtle">{new Date(event.at).toLocaleString()}</p>
                  </div>
                )) : <p className="text-xs text-fg-muted">{t.composioTriggersEmpty}</p>}
              </div>
            </section>
          </div>
        </div>
      </details>

      <ConfirmDialog
        open={revokeAuthorizationId !== null}
        title={t.composioRevoke}
        description={t.composioRevokeConfirm}
        confirmLabel={t.composioRevoke}
        cancelLabel={t.modalCancel}
        destructive
        onConfirm={() => {
          const authorizationId = revokeAuthorizationId;
          setRevokeAuthorizationId(null);
          if (authorizationId) void mutateConnection(() => revokeComposioConnection(authorizationId));
        }}
        onCancel={() => setRevokeAuthorizationId(null)}
      />
    </div>
  );
}
