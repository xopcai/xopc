import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { Config } from '../../config/schema.js';
import { executeExternalOperation, ExternalEffectNotAppliedError } from '../../capabilities/runtime/external-operations.js';
import { CapabilityError } from '../../capabilities/runtime/dispatcher.js';
import { connectorArgumentsHash, connectorArgumentsPreview } from '../../connectors/approval.js';
import { selectConnectorAccount } from '../../connectors/account-selection.js';
import { cliContextPath } from '../../connectors/cli/process.js';
import { getCliAdapter } from '../../connectors/cli/adapterRegistry.js';
import { describeCliAction, executeCliAction } from '../../connectors/cli/runtime.js';
import { cliOwnerId, recoverCliExecutions } from '../../connectors/cli/store.js';
import { validateActionInput } from '../../connectors/cli/protocol.js';
import { listConnectorInstances } from '../../connectors/instances.js';
import { evaluateConnectorExecutionPolicy } from '../../connectors/policy.js';
import { connectorPrincipalForSession } from '../../connectors/principal.js';
import { isXopcDatabaseOpen } from '../../storage/sqlite/index.js';
import { getConnectorAccount } from '../../storage/sqlite/connector-account-repository.js';
import { appendConnectorExecutionAudit, consumeConnectorApproval, createConnectorApproval, getConnectorApproval, getConnectorConnection, getConnectorInstallation } from '../../storage/sqlite/connector-repository.js';
import { connectorObjectiveScope, requireSessionConnection, publishConnectionWait } from '../../storage/sqlite/connection-wait-repository.js';
import { getSessionInputState } from '../../storage/sqlite/session-input-repository.js';
import { getSqliteDatabase, runSqliteWriteTransaction } from '../../storage/sqlite/transaction.js';
import { externalToolRef, parseExternalToolRef } from './refs.js';
import type { ExternalToolProvider, ExternalToolExecutionContext, ExternalToolTurnContext } from './types.js';

const result = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }], details: {} });

export class CliToolProvider implements ExternalToolProvider {
  readonly source = 'cli' as const;
  constructor(private readonly deps: { getConfig: () => Config | undefined; getCurrentContext: () => ExternalToolTurnContext | null; agentId?: string }) {}

  private available() {
    const config = this.deps.getConfig();
    if (!config || !isXopcDatabaseOpen()) return [];
    recoverCliExecutions();
    const principal = connectorPrincipalForSession(this.deps.getCurrentContext()?.conversationId);
    return listConnectorInstances(config).flatMap(instance => {
      if (instance.materialized.type !== 'cli' || !instance.enabled) return [];
      const policy = getConnectorInstallation(`${instance.connectorId}-${principal.principalId}`);
      const agentId = this.deps.agentId ?? principal.agentId;
      if (!policy?.enabled || (policy.allowedAgentIds.length && (!agentId || !policy.allowedAgentIds.includes(agentId)))) return [];
      return [{ config, instance, policy, principal, agentId, adapter: getCliAdapter(instance.materialized.adapterId) }];
    });
  }

  async search(query: string) {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return this.available().flatMap(item => {
      const accounts = selectConnectorAccount({ installation: item.policy, agentId: item.agentId, accept: c => c.provider === 'cli' && c.metadata.runtimeInstanceId === item.instance.instanceId }).candidates;
      if (!accounts.length) return [];
      return Object.entries(item.adapter.curatedActions).filter(([id, scope]) => {
        const text = `${item.instance.displayName} ${item.instance.connectorId} ${item.adapter.id} ${id}`.toLowerCase();
        return (!words.length || words.some(word => text.includes(word))) && evaluateConnectorExecutionPolicy({ installation: item.policy, action: { scope, curated: true }, agentId: item.agentId, accountId: accounts[0]!.accountId, confirmed: true }).decision === 'allowed';
      }).map(([id]) => ({ toolRef: externalToolRef('cli', item.instance.instanceId, id), source: this.source, namespace: item.instance.connectorId, title: id, summary: `${item.instance.displayName}: ${id}` }));
    });
  }

  async describe(toolRef: string) {
    const parsed = parseExternalToolRef(toolRef, this.source);
    const item = this.available().find(value => value.instance.instanceId === parsed?.namespace);
    if (!item || !parsed) return undefined;
    const selected = selectConnectorAccount({ installation: item.policy, agentId: item.agentId, accept: c => c.provider === 'cli' && c.metadata.runtimeInstanceId === item.instance.instanceId });
    const connection = selected.connection ?? selected.candidates[0];
    if (!connection) return undefined;
    const action = await describeCliAction(item.config, item.instance.instanceId, connection, parsed.toolName);
    if (evaluateConnectorExecutionPolicy({ installation: item.policy, action: { scope: action.scope, curated: true }, agentId: item.agentId, accountId: connection.accountId, confirmed: true }).decision !== 'allowed') return undefined;
    return { toolRef, source: this.source, namespace: item.instance.connectorId, title: action.id, summary: action.description, description: action.description,
      batchRead: action.scope === 'read', inputSchema: { ...action.inputSchema, properties: { ...(action.inputSchema.properties as Record<string, unknown>),
        xopcAccountId: { type: 'string', description: 'Stable account ID; required when multiple accounts are available.' },
        xopcExportResult: { type: 'boolean', description: 'Save the successful result as a JSON artifact in this account context.' } } } };
  }

  async execute(toolRef: string, args: Record<string, unknown>, approvalId: string | undefined, context: ExternalToolExecutionContext) {
    const parsed = parseExternalToolRef(toolRef, this.source);
    const item = this.available().find(value => value.instance.instanceId === parsed?.namespace);
    if (!item || !parsed) throw new Error('CLI connector is unavailable.');
    const conversationId = this.deps.getCurrentContext()?.conversationId;
    const selected = selectConnectorAccount({ installation: item.policy, agentId: item.agentId, conversationId,
      requestedAccountId: typeof args.xopcAccountId === 'string' ? args.xopcAccountId : undefined,
      accept: c => c.provider === 'cli' && c.metadata.runtimeInstanceId === item.instance.instanceId });
    const connection = selected.connection;
    if (!connection) return result({ status: 'account_selection_required', accounts: selected.candidates.map(c => ({ id: c.accountId, identity: c.identity })), instruction: 'Select a connected account using xopcAccountId. Never substitute another account.' });
    const action = await describeCliAction(item.config, item.instance.instanceId, connection, parsed.toolName);
    if (args.xopcExportResult !== undefined && typeof args.xopcExportResult !== 'boolean') throw new Error('Invalid export option.');
    const exportResult = args.xopcExportResult === true;
    const input = { ...args }; delete input.xopcAccountId; delete input.xopcExportResult;
    validateActionInput(action, input);
    const scopes = Array.isArray(connection.metadata.scopes) ? connection.metadata.scopes : [];
    if (action.requiredScopes.some(scope => !scopes.includes(scope))) throw new Error('CLI account is missing required scopes. Reauthorize this account.');
    const descriptorDigest = connectorArgumentsHash({ action, adapterVersion: item.adapter.version, binaryVersion: item.adapter.binaryVersion });
    const argumentsHash = () => connectorArgumentsHash({ args: input, exportResult, instanceId: item.instance.instanceId, accountId: connection.accountId, connectionId: connection.id,
      descriptorDigest, principalId: item.principal.principalId, agentId: item.agentId, conversationId, objective: conversationId ? connectorObjectiveScope(conversationId) : undefined });
    const decision = evaluateConnectorExecutionPolicy({ installation: item.policy, action: { scope: action.scope, curated: true }, agentId: item.agentId, accountId: connection.accountId, confirmed: Boolean(approvalId) });
    if (decision.decision === 'denied') throw new Error(decision.reason);
    if (decision.decision === 'confirmation_required') {
      const wait = conversationId && getSessionInputState(conversationId).activeInputId ? requireSessionConnection({ conversationId, principalId: item.principal.principalId,
        agentId: item.agentId ?? 'main', summary: `Confirm ${action.id}`, needs: [{ key: `${item.instance.connectorId}:${connection.accountId}`, target: { type: 'connector', connectorId: item.instance.connectorId }, accountId: connection.accountId, connectionId: connection.id, label: item.instance.displayName, capabilities: [action.id] }] }) : undefined;
      const approval = createConnectorApproval({ principalId: item.principal.principalId, connectorId: item.instance.connectorId, connectionId: connection.id, agentId: item.agentId, conversationId,
        waitId: wait?.waitId, actionId: action.id, scope: action.scope, argumentsHash: argumentsHash(),
        argumentsPreview: { account: { id: connection.accountId, identity: connection.identity }, arguments: connectorArgumentsPreview(input) }, expiresAt: new Date(Date.now() + 600_000).toISOString() });
      if (wait && conversationId) publishConnectionWait(conversationId);
      return result({ status: 'confirmation_required', approvalId: approval.id, argumentsPreview: approval.argumentsPreview, instruction: 'Approve this exact action in xopc, then retry with unchanged arguments and approvalId.' });
    }
    if (approvalId) {
      const approval = getConnectorApproval(approvalId);
      if (!approval || approval.argumentsHash !== argumentsHash()
        || !['approved', 'consumed'].includes(approval.status)
        || (approval.status === 'approved' && Date.parse(approval.expiresAt) <= Date.now())) {
        return result({ outcome: 'failed', error: { kind: 'approval', message: 'Approval is invalid, expired or belongs to a different operation.' } });
      }
    }
    const acceptedArgumentsHash = argumentsHash();
    const authorizeCurrent = () => {
      const freshPolicy = getConnectorInstallation(item.policy.id);
      const freshConnection = getConnectorConnection(connection.id);
      const currentConfig = this.deps.getConfig();
      const enabled = currentConfig && listConnectorInstances(currentConfig).some(instance => instance.instanceId === item.instance.instanceId && instance.enabled && instance.materialized.type === 'cli');
      const currentScopes = Array.isArray(freshConnection?.metadata.scopes) ? freshConnection.metadata.scopes : [];
      if (!enabled || !freshPolicy || freshConnection?.status !== 'active' || getConnectorAccount(connection.accountId!)?.currentConnectionId !== connection.id
        || action.requiredScopes.some(scope => !currentScopes.includes(scope))
        || (action.anyScopes?.length && !action.anyScopes.some(scope => currentScopes.includes(scope)))
        || !selectConnectorAccount({ installation: freshPolicy, agentId: item.agentId, conversationId, requestedAccountId: connection.accountId }).connection
        || evaluateConnectorExecutionPolicy({ installation: freshPolicy, action: { scope: action.scope, curated: true }, accountId: connection.accountId, agentId: item.agentId, confirmed: Boolean(approvalId) }).decision !== 'allowed') {
        throw new CapabilityError('FORBIDDEN', 'Connector permission changed.');
      }
      if (argumentsHash() !== acceptedArgumentsHash) throw new CapabilityError('REVISION_CONFLICT', 'Connector objective changed.');
    };
    const execute = async (executionId: string) => {
      let authorized = false;
      const beforeExecute = () => {
        runSqliteWriteTransaction(db => {
          const hash = argumentsHash();
          authorizeCurrent();
          if (approvalId) {
            const approval = getConnectorApproval(approvalId);
            if (!approval || approval.argumentsHash !== hash || !consumeConnectorApproval(approvalId, hash)) throw new Error('Approval is invalid, expired or already consumed.');
          }
          db.prepare(`INSERT INTO connector_cli_executions (id,instance_id,account_id,connection_id,action_id,revision,arguments_hash,status,owner_id,started_at)
            VALUES (?,?,?,?,?,?,?,'running',?,?)`).run(executionId, item.instance.instanceId, connection.accountId!, connection.id, action.id, action.revision, hash, cliOwnerId, Date.now());
        });
        authorized = true;
      };
      const started = Date.now();
      let output;
      try { output = await executeCliAction(item.config, item.instance.instanceId, connection, action, input, context.signal, beforeExecute); }
      catch (error) { output = { outcome: authorized && action.scope !== 'read' ? 'unknown' as const : 'failed' as const, error: { kind: 'runtime', message: error instanceof Error ? error.message : 'CLI failed.' } }; }
      if (authorized && action.scope !== 'read' && output.outcome === 'failed' && output.error?.kind !== 'startup') {
        // A provider's nonzero exit does not prove that a remote write was never applied.
        output = { ...output, outcome: 'unknown' as const };
      }
      getSqliteDatabase().prepare('UPDATE connector_cli_executions SET status = ?, error_kind = ?, finished_at = ? WHERE id = ?').run(output.outcome, output.error?.kind ?? null, Date.now(), executionId);
      appendConnectorExecutionAudit({ installationId: item.policy.id, connectionId: connection.id, connectorId: item.instance.connectorId, principalId: item.principal.principalId, agentId: item.agentId, conversationId,
        actionId: action.id, scope: action.scope, decision: authorized ? 'allowed' : 'denied', resultStatus: output.outcome === 'success' ? 'success' : 'error', errorCode: output.outcome === 'unknown' ? 'outcome_unknown' : output.error?.kind, durationMs: Date.now() - started });
      if (action.scope !== 'read' && output.outcome !== 'success') {
        if (!authorized || output.error?.kind === 'startup') throw new ExternalEffectNotAppliedError(output.error?.message ?? 'CLI execution was rejected before spawning');
        throw new Error(output.error?.message ?? 'CLI write outcome could not be confirmed');
      }
      let artifact: string | undefined;
      if (exportResult && output.outcome === 'success') {
        try {
          await writeFile(join(cliContextPath(String(connection.metadata.contextId)), 'files', `${executionId}.json`), JSON.stringify(output.data ?? null, null, 2), { mode: 0o600, flag: 'wx' });
          artifact = `/api/connectors/executions/${executionId}/artifact`;
        } catch { return result({ executionId, accountId: connection.accountId, ...output, artifactError: 'The action succeeded, but its JSON export could not be saved. Do not repeat the action to retry export.' }); }
      }
      return result({ ...(authorized ? { executionId } : {}), artifact, accountId: connection.accountId, ...output, ...(output.outcome === 'unknown' ? { instruction: 'The write may have succeeded. Inspect the provider using a read action; do not retry automatically.' } : {}) });
    };
    context.signal?.throwIfAborted();
    authorizeCurrent();
    if (action.scope === 'read') return execute(randomUUID());
    return executeExternalOperation({
      principalId: item.principal.principalId, capabilityId: toolRef,
      idempotencyKey: connectorArgumentsHash(approvalId ? { approvalId } : { conversationId, toolCallId: context.toolCallId }),
      requestDigest: acceptedArgumentsHash,
      descriptorDigest,
      surface: 'agent', recovery: 'manual',
    }, execute);
  }
}
