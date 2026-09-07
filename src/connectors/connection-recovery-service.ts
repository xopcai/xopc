import { randomUUID } from 'node:crypto';
import type { Config } from '../config/schema.js';
import { persistConfigMutation } from '../config/config-mutation.js';
import { getSqliteDatabase } from '../storage/sqlite/transaction.js';
import { readCurrentSessionId } from '../storage/sqlite/session-repository.js';
import type { SessionInput } from '../storage/sqlite/session-input-repository.js';
import { getSessionInputState } from '../storage/sqlite/session-input-repository.js';
import { cancelConnectionObjective, getActiveConnectionWait, getConnectionWait, publishConnectionWait, queueConnectionResolution, updateConnectionWait, listConnectionWaitsToCheck } from '../storage/sqlite/connection-wait-repository.js';
import { getConnectorInstallation, listConnectorConnections, upsertConnectorInstallation } from '../storage/sqlite/connector-repository.js';
import { capabilityActions, isToolInputSchema, missingConnectionCapabilities } from './connection-capabilities.js';
import { resolveConnectionCandidate } from './connection-candidates.js';
import { getConnectorDefinition } from './catalog.js';
import { installConnector } from './install.js';
import { getConnectorInstance } from './instances.js';
import { createLogger } from '../utils/logger.js';
import { getConfiguredComposioAuthConfigs, scopeForComposioAction, isComposioActionAllowedByCatalog } from './composio.js';
import { ComposioSessionsAdapter } from './composio-sessions.js';
import { connectorPrincipalForSession } from './principal.js';
import type { ConnectionNeedView, ConnectionWait, ConnectionWaitSnapshot, ConnectionWaitView } from '@xopcai/gateway-contract';

const log = createLogger('Connectors:Recovery');
const SCOPE_ORDER = { read: 1, write: 2, admin: 3 };
const INTENT_TTL = 30 * 60_000;
const ATTEMPT_TTL = 10 * 60_000;
export type ConnectionAction = {
  waitId: string; expectedSessionId: string; expectedVersion: number; idempotencyKey: string;
  action: 'connect' | 'check' | 'continue' | 'skip' | 'cancel' | 'select_account' | 'confirm_scope' | 'replace_source';
  needKey?: string; accountId?: string; candidateRef?: string;
};

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
        if (this.busy.has(wait.sessionKey)) continue;
        await this.act(wait.sessionKey, { waitId: wait.id, expectedSessionId: wait.sessionId,
          expectedVersion: wait.version, idempotencyKey: randomUUID(), action: 'check',
        }).catch(() => { /* Preserve the wait; network failures never imply authorization loss. */ });
      }
    } finally { this.polling = false; }
  }
  constructor(private readonly deps: {
    getConfig: () => Config;
    saveConfig: (config: Config) => Promise<{ saved: boolean; error?: string }>;
    drain: (sessionKey: string) => void;
    adapter?: ComposioSessionsAdapter;
  }) {}
  private get adapter() { return this.deps.adapter ?? new ComposioSessionsAdapter(); }

  snapshot(sessionKey: string): ConnectionWaitSnapshot {
    if (!connectorPrincipalForSession(sessionKey).isLocalOwner) throw new Error('This connection belongs to another principal.');
    const sessionId = readCurrentSessionId(getSqliteDatabase(), sessionKey);
    if (!sessionId) throw new Error('SESSION_CHANGED');
    const wait = getActiveConnectionWait(sessionKey);
    return { sessionId, revision: getSessionInputState(sessionKey).revision, wait: wait ? this.view(wait) : null };
  }

  private view(wait: ConnectionWait, verifiedIds?: Set<string>): ConnectionWaitView {
    const needs: ConnectionNeedView[] = wait.needs.map(need => {
      const instance = getConnectorInstance(this.deps.getConfig(), need.connectorId);
      const installation = getConnectorInstallation(`${need.connectorId}-${wait.principalId}`);
      const requiredScope = Math.max(1, ...need.capabilities.filter(capability => /^[A-Z]+_/.test(capability)).map(capability => SCOPE_ORDER[scopeForComposioAction(capability).scope]));
      const scopeBlocked = requiredScope > SCOPE_ORDER[installation?.maxScope ?? 'read'];
      const blocked = scopeBlocked || instance?.enabled === false || installation?.enabled === false
        || Boolean(installation?.allowedAgentIds.length && !installation.allowedAgentIds.includes(wait.agentId));
      const all = listConnectorConnections({ principalId: wait.principalId, connectorId: need.connectorId });
      const active = all.filter(connection => connection.status === 'active'
        && (!verifiedIds || verifiedIds.has(connection.id))
        && (!need.accountId || connection.accountId === need.accountId)
        && (!installation?.selectedConnectionIds.length || installation.selectedConnectionIds.includes(connection.id)));
      const selected = !verifiedIds && need.unavailable ? undefined : need.attempt ? active.find(connection => connection.providerConnectionId === need.attempt?.connectionId)
        : need.connectionId ? active.find(connection => connection.id === need.connectionId)
          : active.length === 1 && !need.accountSelector ? active[0] : undefined;
      const phase = blocked || (selected && need.capabilityError) ? 'blocked' : selected && instance ? 'ready'
        : active.length > 1 || (need.accountSelector && active.length > 0 && !need.connectionId) ? 'choose_account'
          : need.attempt && need.attempt.expiresAt > Date.now() ? 'authorizing'
            : need.unavailable || all.some(connection => ['expired', 'revoked', 'failed'].includes(connection.status)) ? 'reconnect' : 'connect';
      const alternatives = ['composio-gmail', 'composio-outlook'].includes(need.connectorId)
        ? ['composio-gmail', 'composio-outlook'].filter(id => id !== need.connectorId).map(id => ({ candidateRef: id, label: getConnectorDefinition(id)?.displayName ?? id })) : [];
      return { ...need, alternatives, connectionId: selected?.id ?? need.connectionId, phase,
        accounts: active.map(connection => ({ id: connection.id,
          label: connection.alias ?? String(connection.identity.email ?? connection.identity.name ?? connection.id) })),
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

  private async checkCapabilities(wait: ConnectionWait, verified: Set<string>): Promise<ConnectionWait['needs']> {
    const views = this.view({ ...wait, needs: wait.needs.map(need => ({ ...need, capabilityError: undefined })) }, verified).needs;
    return Promise.all(wait.needs.map(async need => {
      if (views.find(view => view.key === need.key)?.phase !== 'ready') return { ...need, capabilityError: undefined };
      try {
        const definition = getConnectorDefinition(need.connectorId);
        if (definition?.runtime.type !== 'composio' || definition.runtime.role !== 'toolkit') throw new Error('Unsupported connector');
        const toolkit = definition.runtime.toolkit;
        const session = await this.adapter.createSession({ principalId: wait.principalId, toolkits: [toolkit],
          authConfigs: getConfiguredComposioAuthConfigs(this.deps.getConfig(), [toolkit]) });
        const result = await session.search({ query: `${toolkit} ${need.capabilities.join(' ')} ${capabilityActions(need).flat().join(' ')}`, toolkits: [toolkit] });
        const schemas = result && typeof result === 'object' ? (result as Record<string, unknown>).toolSchemas : undefined;
        const actions = new Set(Object.entries(schemas && typeof schemas === 'object' ? schemas : {})
          .filter(([action, value]) => value && typeof value === 'object' && isToolInputSchema((value as Record<string, unknown>).inputSchema)
            && isComposioActionAllowedByCatalog(action)).map(([action]) => action));
        const missing = missingConnectionCapabilities(need, actions);
        if (missing.length) log.warn({ sessionKey: wait.sessionKey, connectorId: need.connectorId, missingCapabilities: missing }, 'Connected app lacks required tool contracts');
        return { ...need, capabilityError: missing.length
          ? `${need.label} is connected, but the required tools are unavailable. Retry the tool check; reconnecting will not fix this.` : undefined };
      } catch (err) {
        log.warn({ err, sessionKey: wait.sessionKey, connectorId: need.connectorId }, 'Connected app capability check failed');
        return { ...need, capabilityError: `${need.label} is connected, but its tools could not be checked. Retry the tool check.` };
      }
    }));
  }

  async preflight(input: SessionInput): Promise<boolean> {
    if (input.kind !== 'connection_resume') return true;
    const wait = input.payload ? getConnectionWait(input.payload.waitId) : undefined;
    if (!wait || wait.status !== 'queued' || wait.queuedInputId !== input.id
      || wait.sessionId !== readCurrentSessionId(getSqliteDatabase(), input.sessionKey)) return false;
    if (wait.resolution === 'skipped') return true;
    try {
      const fresh = await this.adapter.syncConnections({ principalId: wait.principalId });
      const verified = new Set(fresh.filter(item => item.status === 'active').map(item => item.id));
      wait.needs = await this.checkCapabilities(wait, verified);
      const checkedNeeds = this.view(wait, verified).needs;
      const ready = checkedNeeds.every(need => need.phase === 'ready');
      wait.needs = wait.needs.map(need => ({ ...need, unavailable: !fresh.some(item => item.id === need.connectionId && item.status === 'active') }));
      const latest = getConnectionWait(wait.id);
      if (latest?.version !== wait.version) return false;
      if (ready && wait.intent && wait.intent.validUntil > Date.now() && wait.intent.objectiveRevision === wait.objectiveRevision) return true;
    } catch {
      // A failed readiness check preserves the objective for an explicit retry.
    }
    const latest = getConnectionWait(wait.id);
    if (latest?.version === wait.version) {
      updateConnectionWait({ ...wait, status: 'open', intent: undefined, queuedInputId: undefined, objectiveRevision: wait.objectiveRevision + 1 }, wait.version);
      publishConnectionWait(input.sessionKey);
    }
    return false;
  }

  async act(sessionKey: string, action: ConnectionAction): Promise<{ snapshot: ConnectionWaitSnapshot; authorizationUrl?: string }> {
    const ownsLock = !this.busy.has(sessionKey);
    if (!ownsLock && !['cancel', 'skip', 'replace_source'].includes(action.action)) throw new Error('WAIT_CHANGED');
    if (ownsLock) this.busy.add(sessionKey);
    try {
      const snapshot = this.snapshot(sessionKey);
      let wait = getConnectionWait(action.waitId);
      if (!wait || wait.sessionKey !== sessionKey || wait.principalId !== 'local-owner'
        || wait.sessionId !== action.expectedSessionId || snapshot.sessionId !== action.expectedSessionId) throw new Error('SESSION_CHANGED');
      if (wait.lastAction?.key === action.idempotencyKey && wait.lastAction.action === action.action) return { snapshot };
      if (wait.status !== 'open' || wait.version !== action.expectedVersion) throw new Error('WAIT_CHANGED');
      wait = { ...wait, lastAction: { key: action.idempotencyKey, action: action.action } };
      if (action.action === 'cancel') {
        cancelConnectionObjective(sessionKey);
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
        this.deps.drain(sessionKey);
      } else if (action.action === 'connect') {
        const need = wait.needs.find(need => need.key === action.needKey);
        if (!need) throw new Error('Unknown connection requirement.');
        if (this.view(wait).needs.find(item => item.key === need.key)?.phase === 'blocked') throw new Error('Connector policy blocks this connection.');
        const definition = getConnectorDefinition(need.connectorId);
        if (definition?.runtime.type !== 'composio' || definition.runtime.role !== 'toolkit') throw new Error('Unsupported connector.');
        // Commit the attempt before leaving the process; late results cannot change a newer wait.
        const attemptId = randomUUID();
        wait = updateConnectionWait({ ...wait,
          intent: { objectiveRevision: wait.objectiveRevision, validUntil: Date.now() + INTENT_TTL },
          needs: wait.needs.map(item => item.key === need.key ? { ...item, attempt: { id: attemptId, expiresAt: Date.now() + ATTEMPT_TTL } } : item),
        }, wait.version);
        publishConnectionWait(sessionKey);
        const config = this.deps.getConfig();
        if (!getConnectorInstance(config, need.connectorId)) {
          await persistConfigMutation({ config, mutate: () => installConnector(config, need.connectorId, {}), save: () => this.deps.saveConfig(config) });
        }
        const installationId = `${need.connectorId}-${wait.principalId}`;
        if (!getConnectorInstallation(installationId)) upsertConnectorInstallation({
          id: installationId, connectorId: need.connectorId, principalId: wait.principalId,
          enabled: true, allowedAgentIds: [], maxScope: 'read', confirmationPolicy: 'writes', selectedConnectionIds: [],
        });
        const auth = await this.adapter.authorize({ principalId: wait.principalId, toolkit: definition.runtime.toolkit,
          installationId, authConfigId: getConfiguredComposioAuthConfigs(config, [definition.runtime.toolkit])?.[definition.runtime.toolkit] });
        const latest = getConnectionWait(wait.id);
        if (!latest || latest.version !== wait.version || latest.status !== 'open') throw new Error('WAIT_CHANGED');
        updateConnectionWait({ ...wait, needs: wait.needs.map(item => item.key === need.key ? {
          ...item, attempt: { id: attemptId, connectionId: auth.connectionId, expiresAt: Date.now() + ATTEMPT_TTL },
        } : item) }, wait.version);
        publishConnectionWait(sessionKey);
        log.info({ sessionKey, waitId: wait.id, objectiveRevision: wait.objectiveRevision, phase: 'authorization_started' }, 'Connection authorization started');
        return { snapshot: this.snapshot(sessionKey), authorizationUrl: auth.connectUrl };
      } else {
        // Remote errors remain errors. A failed network check is not a revoked authorization.
        const fresh = await this.adapter.syncConnections({ principalId: wait.principalId });
        const verified = new Set(fresh.filter(item => item.status === 'active').map(item => item.id));
        const latest = getConnectionWait(wait.id);
        if (!latest || latest.version !== wait.version || latest.status !== 'open') throw new Error('WAIT_CHANGED');
        let needs: ConnectionWait['needs'] = wait.needs.map(need => {
          const authorized = fresh.find(item => item.providerConnectionId === need.attempt?.connectionId && item.status === 'active');
          return authorized ? { ...need, unavailable: false, ...(need.accountSelector && !need.accountId ? {} : { connectionId: authorized.id, accountId: authorized.accountId }), attempt: undefined }
            : { ...need, unavailable: !fresh.some(item => item.connectorId === need.connectorId && item.status === 'active'
              && (!need.connectionId || item.id === need.connectionId) && (!need.accountId || item.accountId === need.accountId)) };
        });
        if (action.action === 'select_account') {
          const need = needs.find(item => item.key === action.needKey);
          const connection = fresh.find(item => item.id === action.accountId && item.connectorId === need?.connectorId && item.status === 'active');
          if (!need || !connection || !this.view(wait, verified).needs.find(item => item.key === need.key)?.accounts.some(item => item.id === connection.id)) throw new Error('Account is unavailable.');
          needs = needs.map(item => item.key === need.key ? { ...item, connectionId: connection.id, accountId: connection.accountId, unavailable: false } : item);
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
          log.info({ sessionKey, waitId: wait.id, objectiveRevision: wait.objectiveRevision, phase: 'resume_queued' }, 'Connection continuation queued');
          this.deps.drain(sessionKey);
        }
      }
      publishConnectionWait(sessionKey);
      return { snapshot: this.snapshot(sessionKey) };
    } catch (error) {
      const wait = getActiveConnectionWait(sessionKey);
      if (action.action === 'connect' && wait?.status === 'open' && wait.lastAction?.key === action.idempotencyKey) {
        updateConnectionWait({ ...wait, intent: undefined, needs: wait.needs.map(need => need.key === action.needKey ? { ...need, attempt: undefined } : need) }, wait.version);
        publishConnectionWait(sessionKey);
      }
      throw error;
    } finally { if (ownsLock) this.busy.delete(sessionKey); }
  }
}
