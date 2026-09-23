import { describeCliAction, verifyCliConnection } from './cli/runtime.js';
import { getCliAdapter } from './cli/adapterRegistry.js';
import { randomUUID } from 'node:crypto';
import type { Config } from '../config/schema.js';
import { persistConfigMutation } from '../config/config-mutation.js';
import { getSqliteDatabase } from '../storage/sqlite/transaction.js';
import { readCurrentTranscriptId } from '../storage/sqlite/session-repository.js';
import type { SessionInput } from '../storage/sqlite/session-input-repository.js';
import { getSessionInputState } from '../storage/sqlite/session-input-repository.js';
import { cancelConnectionObjective, getActiveConnectionWait, getConnectionWait, publishConnectionWait, queueConnectionResolution, updateConnectionWait, listConnectionWaitsToCheck } from '../storage/sqlite/connection-wait-repository.js';
import { getConnectorConnection, getConnectorInstallation, listConnectorConnections, upsertConnectorInstallation } from '../storage/sqlite/connector-repository.js';
import { capabilityActions, isToolInputSchema, missingConnectionCapabilities } from './connection-capabilities.js';
import { resolveConnectionCandidate } from './connection-candidates.js';
import { getConnectorDefinition } from './catalog.js';
import { installConnector } from './install.js';
import { getInstalledConnectorDefinition, listConnectorInstances } from './instances.js';
import { getConnectorAccount } from '../storage/sqlite/connector-account-repository.js';
import { canAccessConnectorAccount, currentAccountConnections } from './account-access.js';
import { createLogger } from '../utils/logger.js';
import { getConfiguredComposioAuthConfigs, scopeForComposioAction, isComposioActionAllowedByCatalog } from './composio.js';
import { ComposioSessionsAdapter } from './composio-sessions.js';
import { connectorPrincipalForSession } from './principal.js';
import { HostPluginMcpRecovery, type PluginMcpRecovery } from './plugin-mcp-recovery.js';
import type { ConnectionNeed, ConnectionNeedView, ConnectionWait, ConnectionWaitSnapshot, ConnectionWaitView } from '@xopcai/gateway-contract';

const log = createLogger('Connectors:Recovery');
const SCOPE_ORDER = { read: 1, write: 2, admin: 3 };
const INTENT_TTL = 30 * 60_000;
const ATTEMPT_TTL = 10 * 60_000;
export type ConnectionAction = {
  waitId: string; expectedTranscriptId: string; expectedVersion: number; idempotencyKey: string;
  action: 'connect' | 'check' | 'continue' | 'skip' | 'cancel' | 'select_account' | 'confirm_scope' | 'replace_source' | 'submit_callback';
  needKey?: string; accountId?: string; candidateRef?: string; callbackUrl?: string;
};

function isConnectorNeed(need: ConnectionNeed): need is ConnectionNeed & { target: { type: 'connector'; connectorId: string } } {
  return need.target.type === 'connector';
}

/** Authorization lives at click time. Chat history contains only immutable explanations. */
export class ConnectionRecoveryService {
  private readonly busy = new Set<string>();
  private timer?: ReturnType<typeof setInterval>;
  private polling = false;
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => { void this.poll(); }, 5_000);
    this.timer.unref();
    void this.poll();
  }
  stop(): void { clearInterval(this.timer); this.timer = undefined; }
  async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      for (const wait of listConnectionWaitsToCheck()) {
        if (this.busy.has(wait.conversationId)) continue;
        await this.act(wait.conversationId, { waitId: wait.id, expectedTranscriptId: wait.transcriptId,
          expectedVersion: wait.version, idempotencyKey: randomUUID(), action: 'check',
        }).catch(() => { /* Preserve the wait; network failures never imply authorization loss. */ });
      }
    } finally { this.polling = false; }
  }
  constructor(private readonly deps: {
    getConfig: () => Config;
    saveConfig: (config: Config) => Promise<{ saved: boolean; error?: string }>;
    drain: (conversationId: string) => void;
    adapter?: ComposioSessionsAdapter;
    pluginMcp?: PluginMcpRecovery;
  }) {}
  private get adapter() { return this.deps.adapter ?? new ComposioSessionsAdapter(); }
  private get pluginMcp() { return this.deps.pluginMcp ?? new HostPluginMcpRecovery(this.deps.getConfig); }

  snapshot(conversationId: string): ConnectionWaitSnapshot {
    if (!connectorPrincipalForSession(conversationId).isLocalOwner) throw new Error('This connection belongs to another principal.');
    const transcriptId = readCurrentTranscriptId(getSqliteDatabase(), conversationId);
    if (!transcriptId) throw new Error('SESSION_CHANGED');
    const wait = getActiveConnectionWait(conversationId);
    return { transcriptId, revision: getSessionInputState(conversationId).revision, wait: wait ? this.view(wait) : null };
  }

  private view(wait: ConnectionWait, verifiedIds?: Set<string>): ConnectionWaitView {
    const needs: ConnectionNeedView[] = wait.needs.map(need => {
      if (need.target.type === 'plugin-mcp') {
        const availability = this.pluginMcp.availability(need.target);
        const phase = !availability.available || (need.connectionId && need.capabilityError) ? 'blocked'
          : need.connectionId === need.target.serverId ? 'ready'
            : need.attempt && need.attempt.expiresAt > Date.now() ? 'authorizing'
              : need.unavailable ? 'reconnect' : 'connect';
        return { ...need, phase, accounts: [], alternatives: [],
          ...((availability.reason || need.capabilityError) ? { reason: availability.reason ?? need.capabilityError } : {}) };
      }
      const id = need.target.connectorId;
      const instance = listConnectorInstances(this.deps.getConfig()).find(instance => instance.connectorId === id);
      const installation = getConnectorInstallation(`${id}-${wait.principalId}`);
      const cli = instance?.materialized.type === 'cli' ? getCliAdapter(instance.materialized.adapterId) : undefined;
      const requiredScope = Math.max(1, ...need.capabilities.filter(capability => cli || /^[A-Z]+_/.test(capability)).map(capability => SCOPE_ORDER[cli ? cli.curatedActions[capability] ?? 'read' : scopeForComposioAction(capability).scope]));
      const scopeBlocked = requiredScope > SCOPE_ORDER[installation?.maxScope ?? 'read'];
      const all = listConnectorConnections({ principalId: wait.principalId, connectorId: id });
      const requested = need.accountId ? all.find(connection => connection.accountId === need.accountId) : undefined;
      const blocked = scopeBlocked || instance?.enabled === false || installation?.enabled === false
        || installation?.selectedAccountIds?.length === 0
        || Boolean(installation && requested && !canAccessConnectorAccount(requested, installation, wait.agentId))
        || Boolean(installation?.allowedAgentIds.length && !installation.allowedAgentIds.includes(wait.agentId));
      const eligible = all.filter(connection => connection.status === 'active'
        && (!installation || canAccessConnectorAccount(connection, installation, wait.agentId))
        && (!verifiedIds || verifiedIds.has(connection.id))
        && (!need.accountId || connection.accountId === need.accountId)
        && (installation?.selectedAccountIds == null || Boolean(connection.accountId && installation.selectedAccountIds.includes(connection.accountId))));
      const byAccount = new Map<string, (typeof eligible)[number]>();
      for (const connection of eligible) {
        const key = connection.accountId ?? connection.id;
        const previous = byAccount.get(key);
        const preferredId = need.connectionId
          ?? eligible.find(item => item.providerConnectionId === need.attempt?.connectionId)?.id
          ?? (connection.accountId ? getConnectorAccount(connection.accountId)?.currentConnectionId : undefined);
        if (!previous || connection.id === preferredId
          || (previous.id !== preferredId && connection.updatedAt > previous.updatedAt)) byAccount.set(key, connection);
      }
      const active = [...byAccount.values()];
      const selected = !verifiedIds && need.unavailable ? undefined : need.attempt ? active.find(connection => connection.providerConnectionId === need.attempt?.connectionId)
        : need.accountId ? active.find(connection => connection.accountId === need.accountId)
          : need.connectionId ? active.find(connection => connection.id === need.connectionId)
          : active.length === 1 && !need.accountSelector ? active[0] : undefined;
      const phase = blocked || (selected && need.capabilityError) ? 'blocked' : selected ? 'ready'
        : active.length > 1 || (need.accountSelector && active.length > 0 && !need.connectionId) ? 'choose_account'
          : need.attempt && need.attempt.expiresAt > Date.now() ? 'authorizing'
            : need.unavailable || all.some(connection => ['expired', 'revoked', 'failed'].includes(connection.status)) ? 'reconnect' : 'connect';
      const alternatives = ['composio-gmail', 'composio-outlook'].includes(id)
        ? ['composio-gmail', 'composio-outlook'].filter(candidate => candidate !== id).map(candidate => ({ candidateRef: candidate, label: getConnectorDefinition(candidate)?.displayName ?? candidate })) : [];
      return { ...need, alternatives, accountId: selected?.accountId ?? need.accountId, connectionId: selected?.id ?? need.connectionId, phase,
        accounts: active.map(connection => ({ id: connection.accountId!,
          label: [getConnectorAccount(connection.accountId!)?.label, connection.identity.email ?? connection.identity.name ?? connection.accountId].filter(Boolean).join(' · ') })),
        ...(need.capabilityError && selected ? { reason: need.capabilityError } : {}),
        ...(blocked ? { reason: scopeBlocked ? 'This action needs broader permissions. Review connector permissions in settings.' : 'This app is disabled or unavailable to the current agent. Review connector settings.' } : {}),
      };
    });
    const ready = needs.every(need => need.phase === 'ready');
    // A delayed objective is reviewed in its original context, including relative time expressions.
    const review = wait.reviewRequired || (Date.now() - wait.createdAt > INTENT_TTL && !wait.scopeConfirmedAt);
    const { intent: _intent, checkpoint: _checkpoint, ...visible } = wait;
    return { ...visible, needs, timeRange: wait.checkpoint.timeRange, phase: wait.status === 'queued' ? 'queued' : ready ? review ? 'review_scope' : 'ready' : 'needs_connection' };
  }

  private async ensureInstallation(wait: ConnectionWait, connectorId: string): Promise<void> {
    const config = this.deps.getConfig();
    const instance = listConnectorInstances(config).find(item => item.connectorId === connectorId);
    const installationId = `${connectorId}-${wait.principalId}`;
    const installation = getConnectorInstallation(installationId);
    if (instance?.enabled === false || installation?.enabled === false
      || (installation?.allowedAgentIds.length && !installation.allowedAgentIds.includes(wait.agentId))) {
      throw new Error('Connector policy blocks this connection.');
    }
    if (!instance) await persistConfigMutation({ config, mutate: () => installConnector(config, connectorId, {}), save: () => this.deps.saveConfig(config) });
    if (!installation) upsertConnectorInstallation({
      id: installationId, connectorId, principalId: wait.principalId, enabled: true,
      allowedAgentIds: [], maxScope: 'read', confirmationPolicy: 'writes', selectedAccountIds: null,
    });
  }

  private async checkCapabilities(wait: ConnectionWait, verified: Set<string>): Promise<ConnectionWait['needs']> {
    const views = this.view({ ...wait, needs: wait.needs.map(need => ({ ...need, capabilityError: undefined })) }, verified).needs;
    return Promise.all(wait.needs.map(async need => {
      if (need.target.type === 'plugin-mcp') return need;
      if (views.find(view => view.key === need.key)?.phase !== 'ready') return { ...need, capabilityError: undefined };
      try {
        const id = need.target.connectorId;
        const instance = listConnectorInstances(this.deps.getConfig()).find(instance => instance.connectorId === id && instance.enabled);
        if (!instance) throw new Error('Connector setup is unavailable');
        const definition = getInstalledConnectorDefinition(this.deps.getConfig(), instance.instanceId) ?? getConnectorDefinition(id);
        if (definition?.runtime.type === 'cli') {
          const selected = views.find(view => view.key === need.key);
          const connection = selected?.connectionId ? getConnectorConnection(selected.connectionId) : undefined;
          if (!connection || typeof connection.metadata.runtimeInstanceId !== 'string') throw new Error('CLI account is unavailable.');
          for (const capability of need.capabilities) await describeCliAction(this.deps.getConfig(), connection.metadata.runtimeInstanceId, connection, capability);
          return { ...need, capabilityError: undefined };
        }
        if (definition?.runtime.type !== 'composio' || definition.runtime.role !== 'toolkit') throw new Error('Unsupported connector');
        const toolkit = definition.runtime.toolkit;
        const selected = views.find(view => view.key === need.key);
        const connection = selected?.connectionId ? getConnectorConnection(selected.connectionId) : undefined;
        const session = await this.adapter.createSession({ principalId: wait.principalId, toolkits: [toolkit],
          backendId: selected?.accountId ? getConnectorAccount(selected.accountId)?.backendId : undefined,
          ...(typeof connection?.metadata.providerPrincipalId === 'string' ? { providerPrincipalId: connection.metadata.providerPrincipalId } : {}),
          ...(connection ? { connectedAccounts: { [toolkit]: [connection.providerConnectionId] } } : {}),
          authConfigs: typeof connection?.metadata.authConfigId === 'string' ? { [toolkit]: connection.metadata.authConfigId } : undefined });
        const result = await session.search({ query: `${toolkit} ${need.capabilities.join(' ')} ${capabilityActions(need).flat().join(' ')}`, toolkits: [toolkit] });
        const schemas = result && typeof result === 'object' ? (result as Record<string, unknown>).toolSchemas : undefined;
        const actions = new Set(Object.entries(schemas && typeof schemas === 'object' ? schemas : {})
          .filter(([action, value]) => value && typeof value === 'object' && isToolInputSchema((value as Record<string, unknown>).inputSchema)
            && isComposioActionAllowedByCatalog(action)).map(([action]) => action));
        const missing = missingConnectionCapabilities(need, actions);
        if (missing.length) log.warn({ conversationId: wait.conversationId, connectorId: id, missingCapabilities: missing }, 'Connected app lacks required tool contracts');
        return { ...need, capabilityError: missing.length
          ? `${need.label} is connected, but the required tools are unavailable. Retry the tool check; reconnecting will not fix this.` : undefined };
      } catch (err) {
        log.warn({ err, conversationId: wait.conversationId, connectorId: need.target.connectorId }, 'Connected app capability check failed');
        return { ...need, capabilityError: `${need.label} is connected, but its tools could not be checked. Retry the tool check.` };
      }
    }));
  }

  private async syncConnections(wait: ConnectionWait) {
    const config = this.deps.getConfig();
    const instances = listConnectorInstances(config);
    const cliIds = new Set(instances.filter(item => item.materialized.type === 'cli').map(item => item.connectorId));
    const connectorNeeds = wait.needs.filter(isConnectorNeed);
    const fresh = connectorNeeds.some(need => !cliIds.has(need.target.connectorId))
      ? await this.adapter.syncConnections({ principalId: wait.principalId }) : [];
    for (const connection of currentAccountConnections(listConnectorConnections({ principalId: wait.principalId }))) {
      if (connection.provider !== 'cli' || !connectorNeeds.some(need => need.target.connectorId === connection.connectorId)) continue;
      const policy = getConnectorInstallation(`${connection.connectorId}-${wait.principalId}`);
      if (!policy || !canAccessConnectorAccount(connection, policy, wait.agentId)) continue;
      const instanceId = connection.metadata.runtimeInstanceId;
      if (typeof instanceId !== 'string' || !instances.some(item => item.instanceId === instanceId && item.enabled)) continue;
      await verifyCliConnection(config, instanceId, connection);
      fresh.push(connection);
    }
    return fresh;
  }

  private async syncPluginMcpNeeds(wait: ConnectionWait): Promise<ConnectionWait['needs']> {
    return Promise.all(wait.needs.map(async need => {
      if (need.target.type !== 'plugin-mcp') return need;
      const status = await this.pluginMcp.status(need.target);
      if (status.status === 'connected') {
        const verified = await this.pluginMcp.verify(need.target);
        return { ...need, connectionId: need.target.serverId, unavailable: false, attempt: undefined,
          capabilityError: verified.ready ? undefined : verified.error ?? 'The connected MCP tools are unavailable.' };
      }
      if (status.status === 'authorizing') {
        return { ...need, connectionId: undefined, unavailable: false,
          attempt: { id: status.session?.id ?? need.attempt?.id ?? randomUUID(), expiresAt: status.session?.expiresAt ?? Date.now() + ATTEMPT_TTL } };
      }
      return { ...need, connectionId: undefined, unavailable: true, attempt: undefined,
        capabilityError: status.status === 'error' ? status.session?.error : undefined };
    }));
  }

  async preflight(input: SessionInput): Promise<boolean> {
    if (input.kind !== 'connection_resume') return true;
    const wait = input.payload ? getConnectionWait(input.payload.waitId) : undefined;
    if (!wait || wait.status !== 'queued' || wait.queuedInputId !== input.id
      || wait.transcriptId !== readCurrentTranscriptId(getSqliteDatabase(), input.conversationId)) return false;
    if (wait.resolution === 'skipped') return true;
    try {
      const fresh = await this.syncConnections(wait);
      const verified = new Set(fresh.filter(item => item.status === 'active').map(item => item.id));
      wait.needs = await this.syncPluginMcpNeeds(wait);
      wait.needs = wait.needs.map(need => need.target.type === 'plugin-mcp' ? need
        : { ...need, unavailable: !fresh.some(item => item.id === need.connectionId && item.status === 'active') });
      wait.needs = await this.checkCapabilities(wait, verified);
      const checkedNeeds = this.view(wait, verified).needs;
      const ready = checkedNeeds.every(need => need.phase === 'ready');
      const latest = getConnectionWait(wait.id);
      if (latest?.version !== wait.version) return false;
      if (ready && wait.intent && wait.intent.validUntil > Date.now() && wait.intent.objectiveRevision === wait.objectiveRevision) return true;
    } catch {
      // A failed readiness check preserves the objective for an explicit retry.
    }
    const latest = getConnectionWait(wait.id);
    if (latest?.version === wait.version) {
      updateConnectionWait({ ...wait, status: 'open', intent: undefined, queuedInputId: undefined, objectiveRevision: wait.objectiveRevision + 1 }, wait.version);
      publishConnectionWait(input.conversationId);
    }
    return false;
  }

  async act(conversationId: string, action: ConnectionAction): Promise<{ snapshot: ConnectionWaitSnapshot; authorizationUrl?: string }> {
    const ownsLock = !this.busy.has(conversationId);
    if (!ownsLock && !['cancel', 'skip', 'replace_source'].includes(action.action)) throw new Error('WAIT_CHANGED');
    if (ownsLock) this.busy.add(conversationId);
    try {
      const snapshot = this.snapshot(conversationId);
      let wait = getConnectionWait(action.waitId);
      if (!wait || wait.conversationId !== conversationId || wait.principalId !== 'local-owner'
        || wait.transcriptId !== action.expectedTranscriptId || snapshot.transcriptId !== action.expectedTranscriptId) throw new Error('SESSION_CHANGED');
      if (wait.lastAction?.key === action.idempotencyKey && wait.lastAction.action === action.action) return { snapshot };
      if (wait.status !== 'open' || wait.version !== action.expectedVersion) throw new Error('WAIT_CHANGED');
      wait = { ...wait, lastAction: { key: action.idempotencyKey, action: action.action } };
      if (action.action === 'cancel') {
        cancelConnectionObjective(conversationId);
      } else if (action.action === 'replace_source') {
        const need = wait.needs.find(need => need.key === action.needKey);
        if (!need || !this.view(wait).needs.find(item => item.key === need.key)?.alternatives?.some(item => item.candidateRef === action.candidateRef)) throw new Error('Unsupported replacement.');
        const replacement = resolveConnectionCandidate(action.candidateRef!);
        updateConnectionWait({ ...wait, summary: `${wait.summary}\nUse ${replacement.label} instead of ${need.label}, as confirmed by the user.`,
          needs: wait.needs.map(item => item.key === need.key ? replacement : item),
          objectiveRevision: wait.objectiveRevision + 1, intent: undefined,
        }, wait.version);
      } else if (action.action === 'skip') {
        queueConnectionResolution({ ...wait, intent: undefined }, 'skipped');
        this.deps.drain(conversationId);
      } else if (action.action === 'connect') {
        const need = wait.needs.find(need => need.key === action.needKey);
        if (!need) throw new Error('Unknown connection requirement.');
        if (this.view(wait).needs.find(item => item.key === need.key)?.phase === 'blocked') throw new Error('Connector policy blocks this connection.');
        if (need.target.type === 'plugin-mcp') {
          const serverId = need.target.serverId;
          const attemptId = randomUUID();
          wait = updateConnectionWait({ ...wait,
            intent: { objectiveRevision: wait.objectiveRevision, validUntil: Date.now() + INTENT_TTL },
            needs: wait.needs.map(item => item.key === need.key ? { ...item, unavailable: false,
              capabilityError: undefined, attempt: { id: attemptId, expiresAt: Date.now() + ATTEMPT_TTL } } : item),
          }, wait.version);
          publishConnectionWait(conversationId);
          const auth = await this.pluginMcp.start(need.target);
          const latest = getConnectionWait(wait.id);
          if (!latest || latest.version !== wait.version || latest.status !== 'open') throw new Error('WAIT_CHANGED');
          wait = updateConnectionWait({ ...wait, needs: wait.needs.map(item => item.key === need.key ? {
            ...item,
            attempt: auth.status === 'authorizing' ? {
              id: auth.session?.id ?? attemptId,
              expiresAt: auth.session?.expiresAt ?? Date.now() + ATTEMPT_TTL,
            } : undefined,
            connectionId: auth.status === 'connected' ? serverId : undefined,
            unavailable: auth.status === 'error',
            capabilityError: auth.status === 'error' ? auth.session?.error : undefined,
          } : item) }, wait.version);
          publishConnectionWait(conversationId);
          return { snapshot: this.snapshot(conversationId), authorizationUrl: auth.session?.authorizationUrl };
        }
        const id = need.target.connectorId;
        const instance = listConnectorInstances(this.deps.getConfig()).find(item => item.connectorId === id);
        const definition = (instance ? getInstalledConnectorDefinition(this.deps.getConfig(), instance.instanceId) : undefined) ?? getConnectorDefinition(id);
        if (definition?.runtime.type === 'cli') {
          updateConnectionWait({ ...wait, intent: { objectiveRevision: wait.objectiveRevision, validUntil: Date.now() + INTENT_TTL } }, wait.version);
          publishConnectionWait(conversationId);
          return { snapshot: this.snapshot(conversationId), authorizationUrl: `/#/connectors?connector=${encodeURIComponent(id)}` };
        }
        if (definition?.runtime.type !== 'composio' || definition.runtime.role !== 'toolkit') throw new Error('Unsupported connector.');
        // Commit the attempt before leaving the process; late results cannot change a newer wait.
        const attemptId = randomUUID();
        wait = updateConnectionWait({ ...wait,
          intent: { objectiveRevision: wait.objectiveRevision, validUntil: Date.now() + INTENT_TTL },
          needs: wait.needs.map(item => item.key === need.key ? { ...item, attempt: { id: attemptId, expiresAt: Date.now() + ATTEMPT_TTL } } : item),
        }, wait.version);
        publishConnectionWait(conversationId);
        const config = this.deps.getConfig();
        await this.ensureInstallation(wait, id);
        const installationId = `${id}-${wait.principalId}`;
        const auth = await this.adapter.authorize({ principalId: wait.principalId, toolkit: definition.runtime.toolkit,
          expectedAccountId: need.accountId,
          backendId: need.accountId ? getConnectorAccount(need.accountId)?.backendId : undefined,
          installationId, authConfigId: getConfiguredComposioAuthConfigs(config, [definition.runtime.toolkit])?.[definition.runtime.toolkit] });
        const latest = getConnectionWait(wait.id);
        if (!latest || latest.version !== wait.version || latest.status !== 'open') throw new Error('WAIT_CHANGED');
        updateConnectionWait({ ...wait, needs: wait.needs.map(item => item.key === need.key ? {
          ...item, attempt: { id: attemptId, connectionId: auth.connectionId, expiresAt: Date.now() + ATTEMPT_TTL },
        } : item) }, wait.version);
        publishConnectionWait(conversationId);
        log.info({ conversationId, waitId: wait.id, objectiveRevision: wait.objectiveRevision, phase: 'authorization_started' }, 'Connection authorization started');
        return { snapshot: this.snapshot(conversationId), authorizationUrl: auth.connectUrl };
      } else {
        if (action.action === 'submit_callback') {
          const need = wait.needs.find(need => need.key === action.needKey);
          if (!need || need.target.type !== 'plugin-mcp') throw new Error('OAuth callback is unavailable.');
          if (!action.callbackUrl || action.callbackUrl.length > 16_384) throw new Error('Expected the complete OAuth callback URL.');
          await this.pluginMcp.submitCallback(need.target, action.callbackUrl);
        }
        // Remote errors remain errors. A failed network check is not a revoked authorization.
        const fresh = await this.syncConnections(wait);
        const verified = new Set(fresh.filter(item => item.status === 'active').map(item => item.id));
        const latest = getConnectionWait(wait.id);
        if (!latest || latest.version !== wait.version || latest.status !== 'open') throw new Error('WAIT_CHANGED');
        let needs: ConnectionWait['needs'] = wait.needs.map(need => {
          if (need.target.type === 'plugin-mcp') return need;
          const id = need.target.connectorId;
          const authorized = fresh.find(item => item.providerConnectionId === need.attempt?.connectionId && item.status === 'active'
            && item.connectorId === id && (!need.accountId || item.accountId === need.accountId));
          return authorized ? { ...need, unavailable: false, ...(need.accountSelector && !need.accountId ? {} : { connectionId: authorized.id, accountId: authorized.accountId }), attempt: undefined }
            : { ...need, unavailable: !fresh.some(item => item.connectorId === id && item.status === 'active'
              && (!need.connectionId || item.id === need.connectionId) && (!need.accountId || item.accountId === need.accountId)) };
        });
        needs = await this.syncPluginMcpNeeds({ ...wait, needs });
        if (action.action === 'select_account') {
          const need = needs.find(item => item.key === action.needKey);
          if (!need || need.target.type !== 'connector') throw new Error('Account selection is unavailable.');
          const id = need.target.connectorId;
          const connection = currentAccountConnections(fresh).find(item => item.accountId === action.accountId && item.connectorId === id);
          if (!connection || !this.view(wait, verified).needs.find(item => item.key === need.key)?.accounts.some(item => item.id === connection.accountId)) throw new Error('Account is unavailable.');
          needs = needs.map(item => item.key === need.key ? { ...item, connectionId: connection.id, accountId: connection.accountId, unavailable: false, attempt: undefined } : item);
        }
        for (const selected of this.view({ ...wait, needs }, verified).needs) {
          if (selected.target.type === 'connector' && (selected.phase === 'ready' || (selected.capabilityError && selected.connectionId))) {
            await this.ensureInstallation(wait, selected.target.connectorId);
          }
        }
        needs = await this.checkCapabilities({ ...wait, needs }, verified);
        if (getConnectionWait(wait.id)?.version !== wait.version) throw new Error('WAIT_CHANGED');
        const explicitContinue = action.action === 'continue' || action.action === 'confirm_scope';
        wait = updateConnectionWait({ ...wait, needs,
          ...(action.action === 'confirm_scope' ? { scopeConfirmedAt: Date.now(), reviewRequired: false } : {}),
          ...(needs.some(need => need.capabilityError) ? { intent: undefined }
            : explicitContinue ? { intent: { objectiveRevision: wait.objectiveRevision, validUntil: Date.now() + INTENT_TTL } } : {}),
        }, wait.version);
        const view = this.view(wait, verified);
        const canResume = view.phase === 'ready' && wait.intent?.objectiveRevision === wait.objectiveRevision && wait.intent.validUntil > Date.now();
        if (canResume) {
          wait = queueConnectionResolution({ ...wait, needs: view.needs.map(({ phase: _phase, accounts: _accounts, reason: _reason, alternatives: _alternatives, ...need }) => need) }, 'continued');
          log.info({ conversationId, waitId: wait.id, objectiveRevision: wait.objectiveRevision, phase: 'resume_queued' }, 'Connection continuation queued');
          this.deps.drain(conversationId);
        }
      }
      publishConnectionWait(conversationId);
      return { snapshot: this.snapshot(conversationId) };
    } catch (error) {
      const wait = getActiveConnectionWait(conversationId);
      if (action.action === 'connect' && wait?.status === 'open' && wait.lastAction?.key === action.idempotencyKey) {
        updateConnectionWait({ ...wait, intent: undefined, needs: wait.needs.map(need => need.key === action.needKey ? { ...need, attempt: undefined } : need) }, wait.version);
        publishConnectionWait(conversationId);
      }
      throw error;
    } finally { if (ownsLock) this.busy.delete(conversationId); }
  }
}
