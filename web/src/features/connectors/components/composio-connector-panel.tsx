import { Check, Database, KeyRound, Loader2, RefreshCw, Star, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import type { ConnectorsSettingsMessages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { isElectron } from '@/lib/electron-env';
import { settingsInputFocusClass } from '@/lib/form-field-width';

import {
  getComposioScope,
  getComposioPolicy,
  getComposioHealth,
  getComposioMemorySyncProfile,
  listConnectorApprovals,
  listComposioConnections,
  listComposioTools,
  listComposioTriggerEvents,
  refreshComposioConnection,
  respondConnectorApproval,
  revokeComposioConnection,
  setComposioScope,
  startConnectorAuthorization,
  syncComposioMemory,
  updateComposioConnection,
  updateComposioMemorySyncProfile,
  updateComposioPolicy,
  type ComposioConnection,
  type ComposioInstallationPolicy,
  type ComposioConnectorHealth,
  type ComposioScope,
  type ComposioTool,
  type ComposioTriggerEvent,
  type ConnectorApproval,
  type ConnectorAgentOption,
  type ConnectorInstance,
} from '../connectors-api';
import { formatConnectorMessage } from '../utils/connector-i18n';
import { Select, SelectOption } from '@/components/ui/popover-select';

const inputClass = cn(
  'w-full rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg',
  'placeholder:text-fg-subtle',
  settingsInputFocusClass,
);

function toolkitFromComposioInstance(instance: ConnectorInstance): string | null {
  if (instance.materialized.type !== 'composio') return null;
  return instance.materialized.toolkit;
}

function scopeLabel(scope: ComposioScope, t: ConnectorsSettingsMessages): string {
  if (scope === 'write') return t.composioScopeWrite;
  if (scope === 'admin') return t.composioScopeAdmin;
  return t.composioScopeRead;
}

function degradedHealthMessage(health: ComposioConnectorHealth, t: ConnectorsSettingsMessages): string {
  if (health.errorCode === 'missing_credential') return t.composioHealthMissingCredential;
  if (health.errorCode === 'unauthorized') return t.composioHealthUnauthorized;
  if (health.errorCode === 'forbidden') return t.composioHealthForbidden;
  if (health.errorCode === 'network') return t.composioHealthNetwork;
  if (health.errorCode === 'timeout') return t.composioHealthTimeout;
  return t.composioHealthDegraded;
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
  const toolkit = toolkitFromComposioInstance(instance);
  const [connections, setConnections] = useState<ComposioConnection[]>([]);
  const [tools, setTools] = useState<ComposioTool[]>([]);
  const [events, setEvents] = useState<ComposioTriggerEvent[]>([]);
  const [approvals, setApprovals] = useState<ConnectorApproval[]>([]);
  const [policy, setPolicy] = useState<ComposioInstallationPolicy | null>(null);
  const [agents, setAgents] = useState<ConnectorAgentOption[]>([]);
  const [memoryAction, setMemoryAction] = useState('');
  const [memoryArguments, setMemoryArguments] = useState('{}');
  const [memorySynced, setMemorySynced] = useState<string | null>(null);
  const [memoryAutoSync, setMemoryAutoSync] = useState(false);
  const [memoryTriggerSync, setMemoryTriggerSync] = useState(true);
  const [memoryIntervalMinutes, setMemoryIntervalMinutes] = useState('15');
  const [health, setHealth] = useState<ComposioConnectorHealth | null>(null);
  const [scope, setScope] = useState<ComposioScope>('read');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadComposio = useCallback(async () => {
    if (!toolkit || instance.materialized.type !== 'composio' || instance.materialized.role === 'credential') return;
    setLoading(true);
    setError(null);
    try {
      const [nextConnections, nextTools, nextEvents, nextScope, nextApprovals, nextPolicy, nextHealth, nextMemoryProfile] = await Promise.all([
        listComposioConnections().catch(() => []),
        listComposioTools(toolkit).catch(() => []),
        listComposioTriggerEvents(20).catch(() => []),
        getComposioScope(toolkit).catch((): ComposioScope => 'read'),
        listConnectorApprovals().catch(() => []),
        getComposioPolicy(toolkit).catch(() => null),
        getComposioHealth(toolkit).catch(() => null),
        getComposioMemorySyncProfile(instance.connectorId).catch(() => null),
      ]);
      setConnections(nextConnections.filter((connection) => connection.toolkit.toLowerCase() === toolkit.toLowerCase()));
      setTools(nextTools);
      setEvents(nextEvents.filter((event) => !event.toolkit || event.toolkit.toLowerCase() === toolkit.toLowerCase()));
      setScope(nextScope);
      setApprovals(nextApprovals.filter((approval) => approval.connectorId === instance.connectorId));
      setPolicy(nextPolicy?.policy ?? null);
      setAgents(nextPolicy?.agents ?? []);
      setMemoryAction(nextMemoryProfile?.actionId ?? nextTools.find((tool) => tool.scope === 'read' && tool.curated)?.slug ?? '');
      setMemoryArguments(nextMemoryProfile ? JSON.stringify(nextMemoryProfile.arguments) : '{}');
      setMemoryAutoSync(nextMemoryProfile?.enabled ?? false);
      setMemoryTriggerSync(nextMemoryProfile?.triggerSync ?? true);
      setMemoryIntervalMinutes(String(nextMemoryProfile?.intervalMinutes ?? 15));
      setHealth(nextHealth);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, [instance.connectorId, instance.materialized, toolkit]);

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
    } catch (authorizeError) {
      setError(authorizeError instanceof Error ? authorizeError.message : String(authorizeError));
    } finally {
      setLoading(false);
    }
  }, [instance.connectorId, toolkit]);

  const updateScope = useCallback(async (nextScope: ComposioScope) => {
    if (!toolkit) return;
    setScope(nextScope);
    try {
      await setComposioScope(toolkit, nextScope);
      await loadComposio();
    } catch (scopeError) {
      setError(scopeError instanceof Error ? scopeError.message : String(scopeError));
    }
  }, [loadComposio, toolkit]);

  const respondToApproval = useCallback(async (id: string, decision: 'approved' | 'denied') => {
    setLoading(true);
    setError(null);
    try {
      await respondConnectorApproval(id, decision);
      await loadComposio();
    } catch (approvalError) {
      setError(approvalError instanceof Error ? approvalError.message : String(approvalError));
    } finally {
      setLoading(false);
    }
  }, [loadComposio]);

  const patchPolicy = useCallback(async (patch: Parameters<typeof updateComposioPolicy>[1]) => {
    if (!toolkit) return;
    setError(null);
    try {
      setPolicy(await updateComposioPolicy(toolkit, patch));
    } catch (policyError) {
      setError(policyError instanceof Error ? policyError.message : String(policyError));
    }
  }, [instance.connectorId, toolkit]);

  const toggleAgent = useCallback((agentId: string) => {
    if (!policy) return;
    const next = policy.allowedAgentIds.includes(agentId)
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

  const syncMemory = useCallback(async () => {
    if (!toolkit || !memoryAction) return;
    setLoading(true);
    setError(null);
    setMemorySynced(null);
    try {
      const parsed = JSON.parse(memoryArguments) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(t.composioMemoryArgumentsObject);
      const agentId = policy?.allowedAgentIds[0] ?? agents[0]?.id;
      if (!agentId) throw new Error(t.composioMemoryAgentMissing);
      const result = await syncComposioMemory({
        connectorId: instance.connectorId,
        actionId: memoryAction,
        agentId,
        connectionId: connections.find((connection) => connection.isDefault)?.id,
        arguments: parsed as Record<string, unknown>,
      });
      setMemorySynced(result.recordId);
      await onChanged?.();
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : String(syncError));
    } finally {
      setLoading(false);
    }
  }, [agents, connections, instance.connectorId, memoryAction, memoryArguments, onChanged, policy, t, toolkit]);

  const saveMemoryProfile = useCallback(async () => {
    if (!toolkit || !memoryAction) return;
    setLoading(true);
    setError(null);
    try {
      const parsed = JSON.parse(memoryArguments) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(t.composioMemoryArgumentsObject);
      const agentId = policy?.allowedAgentIds[0] ?? agents[0]?.id;
      if (!agentId) throw new Error(t.composioMemoryAgentMissing);
      const profile = await updateComposioMemorySyncProfile(instance.connectorId, {
        enabled: memoryAutoSync,
        actionId: memoryAction,
        arguments: parsed as Record<string, unknown>,
        agentId,
        connectionId: connections.find((connection) => connection.isDefault)?.id,
        intervalMinutes: Number(memoryIntervalMinutes),
        triggerSync: memoryTriggerSync,
      });
      setMemoryIntervalMinutes(String(profile.intervalMinutes));
      await onChanged?.();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setLoading(false);
    }
  }, [
    agents,
    connections,
    instance.connectorId,
    memoryAction,
    memoryArguments,
    memoryAutoSync,
    memoryIntervalMinutes,
    memoryTriggerSync,
    onChanged,
    policy,
    t,
    toolkit,
  ]);

  if (!toolkit) return null;
  if (instance.materialized.type === 'composio' && instance.materialized.role === 'credential') {
    return <p className="mt-3 text-sm text-fg-muted">{t.composioApiKeyStored}</p>;
  }

  return (
    <div className="mt-4 rounded-xl border border-edge bg-surface-base p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-medium text-fg">{formatConnectorMessage(t.composioToolkitTitle, { toolkit })}</p>
          <p className="text-xs text-fg-subtle">{t.composioScopeHint}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" disabled={loading} onClick={() => void authorize()}>
            {loading ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
            {t.connectOAuth}
          </Button>
          <Button variant="ghost" disabled={loading} onClick={() => void loadComposio()}>
            {t.refresh}
          </Button>
        </div>
      </div>
      {error ? <p className="mt-3 rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-600">{error}</p> : null}
      {health ? (
        <div className={cn(
          'mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs',
          health.status === 'connected' ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700' : 'border-amber-500/30 bg-amber-500/5 text-amber-700',
        )}>
          <span>{health.status === 'connected'
            ? formatConnectorMessage(t.composioHealthConnected, { count: String(health.activeConnections) })
            : health.status === 'reauthorization_required'
              ? t.composioHealthReconnect
              : health.status === 'degraded'
                ? degradedHealthMessage(health, t)
                : t.composioHealthDisconnected}</span>
          {health.recovery !== 'none' ? (
            <Button variant="ghost" disabled={loading} onClick={() => void (health.recovery === 'retry' ? loadComposio() : authorize())}>
              {health.recovery === 'retry' ? t.composioRetry : t.connectOAuth}
            </Button>
          ) : null}
          {health.status === 'degraded' && health.message ? (
            <p className="basis-full break-words text-[11px] opacity-80">{health.message}</p>
          ) : null}
        </div>
      ) : null}
      {policy ? (
        <div className="mt-4 grid gap-3 rounded-lg border border-edge bg-surface-panel p-3 md:grid-cols-3">
          <label className="text-xs font-medium text-fg-subtle">
            {t.composioAccessTitle}
            <Select
              className={cn(inputClass, 'mt-1 h-9 py-1')}
              value={scope}
              onChange={(event) => void updateScope(event.currentTarget.value as ComposioScope)}
            >
              <SelectOption value="read">{t.composioAccessReadOnly}</SelectOption>
              <SelectOption value="write">{t.composioAccessReadWrite}</SelectOption>
              {scope === 'admin' ? <SelectOption value="admin">{t.composioAccessAdminCurrent}</SelectOption> : null}
            </Select>
            <span className="mt-1 block font-normal leading-4 text-fg-muted">
              {scope === 'read' ? t.composioAccessReadHint : scope === 'admin' ? t.composioAccessAdminHint : t.composioAccessWriteHint}
            </span>
          </label>
          <label className="text-xs font-medium text-fg-subtle">
            {t.composioConfirmationPolicy}
            <Select
              className={cn(inputClass, 'mt-1 h-9 py-1')}
              value={policy.confirmationPolicy}
              onChange={(event) => void patchPolicy({ confirmationPolicy: event.currentTarget.value as ComposioInstallationPolicy['confirmationPolicy'] })}
            >
              <SelectOption value="writes">{t.composioConfirmWrites}</SelectOption>
              <SelectOption value="always">{t.composioConfirmAlways}</SelectOption>
              {policy.confirmationPolicy === 'never' ? <SelectOption value="never">{t.composioConfirmNever}</SelectOption> : null}
            </Select>
          </label>
          <div>
            <p className="text-xs font-medium text-fg-subtle">{t.composioAllowedAgents}</p>
            <p className="mb-2 text-xs text-fg-muted">{policy.allowedAgentIds.length ? t.composioAllowedAgentsSelected : t.composioAllowedAgentsAll}</p>
            <div className="flex flex-wrap gap-2">
              {agents.map((agent) => {
                const selected = policy.allowedAgentIds.includes(agent.id);
                return (
                  <button
                    key={agent.id}
                    type="button"
                    className={cn('rounded-full border px-2.5 py-1 text-xs transition-colors', selected ? 'border-accent bg-accent/10 text-accent' : 'border-edge text-fg-muted hover:text-fg')}
                    onClick={() => toggleAgent(agent.id)}
                  >
                    {agent.name}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}
      {[
        'gmail', 'googlecalendar', 'googledrive', 'googledocs', 'googlesheets', 'notion',
        'slack', 'github', 'linear', 'jira', 'outlook', 'microsoft_teams', 'one_drive', 'excel',
      ].includes(toolkit) && tools.some((tool) => tool.scope === 'read' && tool.curated) ? (
        <div className="mt-4 rounded-lg border border-edge bg-surface-panel p-3">
          <div className="flex items-start gap-2">
            <Database className="mt-0.5 size-4 text-accent" />
            <div>
              <p className="text-sm font-medium text-fg">{t.composioMemorySync}</p>
              <p className="text-xs text-fg-muted">{t.composioMemorySyncHint}</p>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button disabled={loading || !memoryAction} onClick={() => void syncMemory()}>
              {loading ? <Loader2 className="size-4 animate-spin" /> : <Database className="size-4" />}
              {t.composioSyncNow}
            </Button>
          </div>
          {memorySynced ? <p className="mt-2 text-xs text-emerald-600">{t.composioMemorySyncedSimple}</p> : null}
          <div className="mt-3 flex flex-wrap items-end gap-3 border-t border-edge-subtle pt-3">
            <label className="flex items-center gap-2 text-xs text-fg-muted">
              <input type="checkbox" checked={memoryAutoSync} onChange={(event) => setMemoryAutoSync(event.currentTarget.checked)} />
              {t.composioMemoryAutoSync}
            </label>
            <label className="flex items-center gap-2 text-xs text-fg-muted">
              <input type="checkbox" checked={memoryTriggerSync} onChange={(event) => setMemoryTriggerSync(event.currentTarget.checked)} />
              {t.composioMemoryTriggerSync}
            </label>
            <Button variant="secondary" disabled={loading || !memoryAction} onClick={() => void saveMemoryProfile()}>
              {loading ? <Loader2 className="size-4 animate-spin" /> : <Database className="size-4" />}
              {t.composioMemorySaveSchedule}
            </Button>
          </div>
        </div>
      ) : null}
      {approvals.length ? (
        <div className="mt-4 space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-fg-subtle">{t.composioPendingApprovals}</p>
          {approvals.map((approval) => (
            <div key={approval.id} className="flex flex-col gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="truncate font-mono text-xs font-medium text-fg">{approval.actionId}</p>
                <p className="mt-1 break-all font-mono text-xs text-fg-subtle">{JSON.stringify(approval.argumentsPreview)}</p>
                <p className="mt-1 text-xs text-fg-muted">{formatConnectorMessage(t.composioApprovalExpires, { time: new Date(approval.expiresAt).toLocaleTimeString() })}</p>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button variant="secondary" disabled={loading} onClick={() => void respondToApproval(approval.id, 'denied')}>
                  <X className="size-4" />{t.composioDeny}
                </Button>
                <Button disabled={loading} onClick={() => void respondToApproval(approval.id, 'approved')}>
                  <Check className="size-4" />{t.approve}
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : null}
      <div className="mt-4">
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-subtle">{t.composioConnections}</p>
          {connections.length ? connections.map((connection) => (
            <div key={connection.id} className="space-y-2 rounded-lg border border-edge bg-surface-panel p-2">
              <div>
                <p className="truncate font-mono text-xs text-fg">{connection.accountEmail ?? connection.username ?? connection.workspace ?? connection.providerConnectionId}</p>
                <p className="text-xs text-fg-subtle">{connection.status}{connection.isDefault ? ` · ${t.composioDefaultAccount}` : ''}</p>
              </div>
              <input
                className={cn(inputClass, 'h-8 py-1 text-xs')}
                defaultValue={connection.alias ?? ''}
                placeholder={t.composioAccountAlias}
                onBlur={(event) => {
                  if (event.currentTarget.value !== (connection.alias ?? '')) {
                    void mutateConnection(() => updateComposioConnection(connection.id, { alias: event.currentTarget.value }));
                  }
                }}
              />
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  className="size-8 p-0"
                  title={t.composioMakeDefault}
                  disabled={loading || connection.isDefault}
                  onClick={() => void mutateConnection(async () => {
                    await updateComposioConnection(connection.id, { isDefault: true });
                    if (toolkit) await updateComposioPolicy(toolkit, { selectedConnectionIds: [connection.id] });
                  })}
                ><Star className={cn('size-4', connection.isDefault && 'fill-current')} /></Button>
                <Button variant="ghost" className="size-8 p-0" title={t.refresh} disabled={loading} onClick={() => void mutateConnection(() => refreshComposioConnection(connection.id))}>
                  <RefreshCw className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  className="size-8 p-0"
                  title={t.composioRevoke}
                  disabled={loading}
                  onClick={() => {
                    if (window.confirm(t.composioRevokeConfirm)) void mutateConnection(() => revokeComposioConnection(connection.id));
                  }}
                ><Trash2 className="size-4 text-red-500" /></Button>
              </div>
            </div>
          )) : <p className="text-xs text-fg-muted">{t.composioConnectionsEmpty}</p>}
        </div>
      </div>
      <details className="mt-4 rounded-lg border border-edge bg-surface-panel p-3">
        <summary className="cursor-pointer text-xs font-medium text-fg-muted">{t.composioAdvancedSettings}</summary>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div className="space-y-3">
            <label className="block text-xs text-fg-subtle">
              {t.composioAdvancedScope}
              <Select className={cn(inputClass, 'mt-1 h-9 py-1')} value={scope} onChange={(event) => void updateScope(event.currentTarget.value as ComposioScope)}>
                <SelectOption value="read">{t.composioScopeRead}</SelectOption>
                <SelectOption value="write">{t.composioScopeWrite}</SelectOption>
                <SelectOption value="admin">{t.composioScopeAdmin}</SelectOption>
              </Select>
            </label>
            <label className="block text-xs text-fg-subtle">
              {t.composioMemoryReadAction}
              <Select className={cn(inputClass, 'mt-1 h-9 py-1')} value={memoryAction} onChange={(event) => setMemoryAction(event.currentTarget.value)}>
                {tools.filter((tool) => tool.scope === 'read' && tool.curated).map((tool) => (
                  <SelectOption key={tool.slug} value={tool.slug}>{tool.name ?? tool.slug}</SelectOption>
                ))}
              </Select>
            </label>
            <label className="block text-xs text-fg-subtle">
              {t.composioMemoryArguments}
              <input className={cn(inputClass, 'mt-1 h-9 py-1 font-mono text-xs')} value={memoryArguments} onChange={(event) => setMemoryArguments(event.currentTarget.value)} />
            </label>
            <label className="block text-xs text-fg-subtle">
              {t.composioMemoryInterval}
              <input type="number" min={5} max={1440} className={cn(inputClass, 'mt-1 h-9 w-28 py-1')} value={memoryIntervalMinutes} onChange={(event) => setMemoryIntervalMinutes(event.currentTarget.value)} />
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-subtle">{t.composioAgentTools}</p>
              {tools.length ? tools.slice(0, 8).map((tool) => (
                <div key={tool.slug} className="rounded-lg border border-edge bg-surface-base p-2">
                  <p className="truncate font-mono text-xs text-fg">{tool.slug}</p>
                  <p className="text-xs text-fg-subtle">{scopeLabel(tool.scope, t)}{tool.curated ? '' : ` ${t.composioUncuratedSuffix}`}</p>
                </div>
              )) : <p className="text-xs text-fg-muted">{t.composioToolsEmpty}</p>}
            </div>
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-subtle">{t.composioRecentTriggers}</p>
              {events.length ? events.slice(0, 5).map((event) => (
                <div key={`${event.id}-${event.at}`} className="rounded-lg border border-edge bg-surface-base p-2">
                  <p className="truncate text-xs text-fg">{event.trigger ?? event.id}</p>
                  <p className="text-xs text-fg-subtle">{new Date(event.at).toLocaleString()}</p>
                </div>
              )) : <p className="text-xs text-fg-muted">{t.composioTriggersEmpty}</p>}
            </div>
          </div>
        </div>
      </details>
    </div>
  );
}
