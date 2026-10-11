import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import { Type } from '@sinclair/typebox';

import type { Config } from '../../config/schema.js';
import {
  getStoreConnectorInstallPlan,
  parseStoreConnectorCandidateRef,
  searchStoreConnectorInstallCandidates,
} from '../../capabilities/store-connector.js';
import { getConnectorConnection, getConnectorInstallation, listConnectorActionMetadata, listConnectorConnections } from '../../storage/sqlite/connector-repository.js';
import { getConnectorAccount } from '../../storage/sqlite/connector-account-repository.js';
import { getSessionMetadata } from '../../storage/sqlite/session-repository.js';
import { isXopcDatabaseOpen } from '../../storage/sqlite/connection.js';
import { personalRequestForExecution } from '../../personal-agent/request-repository.js';
import { parseExternalToolRef } from './refs.js';
import { listConnectorInstances } from '../../connectors/instances.js';
import { connectionCandidates, resolveConnectionCandidate } from '../../connectors/connection-candidates.js';
import { connectorPrincipalForSession } from '../../connectors/principal.js';
import { connectionBindings, getActiveConnectionWait, requireSessionConnection, publishConnectionWait, reviseCurrentConnectionObjective } from '../../storage/sqlite/connection-wait-repository.js';
import type { ExternalToolTurnContext } from './types.js';
import { ExternalToolService } from './service.js';
import { EXTERNAL_TOOL_SOURCES, type ExternalToolProvider } from './types.js';
import { bindExternalToolRegistry } from './tool-registry.js';
import { setXopcToolMetadata } from '../embedded/tool-metadata.js';

export const EXTERNAL_TOOL_NAMES = {
  search: 'xopc_tool_search',
  describe: 'xopc_tool_describe',
  execute: 'xopc_tool_execute',
  requireConnection: 'xopc_require_connection',
  updateConnectionObjective: 'xopc_update_connection_objective',
} as const;

const ToolSearchSchema = Type.Object({
  query: Type.String({ description: 'Describe the capability or task you need.' }),
  sources: Type.Optional(Type.Array(Type.Union(EXTERNAL_TOOL_SOURCES.map((source) => Type.Literal(source))), {
    maxItems: EXTERNAL_TOOL_SOURCES.length,
    description: 'Omit to search all sources (recommended). Set only to intentionally restrict providers. Feishu/Lark, WeCom and WPS 365 connectors use cli.',
  })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
});

const ToolDescribeSchema = Type.Object({
  toolRefs: Type.Array(Type.String(), {
    minItems: 1,
    maxItems: 3,
    description: 'Exact tool references returned by xopc_tool_search.',
  }),
});

const ToolExecuteSchema = Type.Object({
  toolRef: Type.String({ description: 'Exact tool reference returned by xopc_tool_search.' }),
  revision: Type.String({ description: 'Exact contract revision returned by xopc_tool_describe.' }),
  arguments: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  approvalId: Type.Optional(Type.String({ description: 'One-time approval id when execution requested confirmation.' })),
  readOnly: Type.Optional(Type.Boolean({ description: 'Require a host-curated batchRead contract; never permits unapproved operations.' })),
});

function textResult(value: unknown, details: Record<string, unknown> = {}): AgentToolResult<Record<string, unknown>> {
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    details,
  };
}

export function createExternalToolGatewayTools(
  providers: ExternalToolProvider[],
  getContext?: () => ExternalToolTurnContext | null,
  getConfig?: () => Config | undefined,
  getExecutionConversationId?: () => string | undefined,
  nativeSources: readonly import('./types.js').ExternalToolSource[] = [],
  executorConfig?: Partial<import('../tools/executor.js').ToolExecutorConfig>,
): AgentTool[] {
  const service = new ExternalToolService(providers);
  const legacySources = EXTERNAL_TOOL_SOURCES.filter(source => !nativeSources.includes(source));
  const assertLegacyRef = (ref: string) => {
    if (nativeSources.some(source => ref.startsWith(`${source}:`))) throw new Error('Use tool_search to load this native tool, then call it directly.');
  };
  const searchTool: AgentTool<typeof ToolSearchSchema, Record<string, unknown>> = {
    name: EXTERNAL_TOOL_NAMES.search,
    label: '🔎 External Tool Search',
    description: `Search external tools from these sources: ${legacySources.join(', ')}.${nativeSources.length ? ` Use tool_search for native ${nativeSources.join(', ')} tools.` : ''} CLI connectors include Feishu/Lark, WeCom and WPS 365. Omit sources unless intentionally restricting the search; do not guess a source list. Use concise English capability keywords, e.g. "wecom doc.search". Returns executable tools, connection candidates, or reviewed Store install candidates. Call xopc_tool_describe before executing a tool. When no executable tool exists but a connection or install candidate is returned, use xopc_require_connection instead of falling back to browser automation. If a source-filtered search finds no relevant tools, retry without sources before concluding a capability is unavailable.`,
    parameters: ToolSearchSchema,
    async execute(_toolCallId, params) {
      const selectedSources = new Set<string>(params.sources ?? []);
      const excludedSources = selectedSources.size ? EXTERNAL_TOOL_SOURCES.filter(source => !selectedSources.has(source)) : [];
      if (params.sources?.length && params.sources.every(source => nativeSources.includes(source))) {
        return textResult({ tools: [], instruction: 'Use tool_search for native tools.' });
      }
      const result = await service.search({ ...params, sources: (params.sources?.length ? params.sources : legacySources)
        .filter(source => !nativeSources.includes(source)) });
      const candidates = [...result.connectionCandidates, ...connectionCandidates(params.query)]
        .filter((candidate, index, all) => all.findIndex(item => item.candidateRef === candidate.candidateRef) === index);
      let installCandidates: Awaited<ReturnType<typeof searchStoreConnectorInstallCandidates>> = [];
      let installCatalogError: string | undefined;
      const config = getConfig?.();
      if (!params.sources?.length && result.tools.length === 0 && candidates.length === 0 && config) {
        try {
          installCandidates = await searchStoreConnectorInstallCandidates(config, params.query, params.limit ?? 5);
        } catch (error) {
          installCatalogError = error instanceof Error ? error.message : String(error);
        }
      }
      return textResult({ ...result, connectionCandidates: candidates, installCandidates,
        ...(result.tools.length === 0 && (candidates.length > 0 || installCandidates.length > 0) ? {
          instruction: 'The requested app is available but is not connected. Explain that connection is required, then call xopc_require_connection with an exact candidateRef from this result. Do not fall back to browser automation unless the user explicitly asked for browser use or skips the connection.',
        } : {}),
        ...(installCatalogError ? { installCatalogError } : {}),
        ...(excludedSources.length ? { searchScope: {
          excludedSources,
          instruction: 'This search excluded these sources. Results from other apps do not establish that the requested app is unavailable. Retry without sources before declaring a capability unavailable or requesting authorization. Feishu/Lark, WeCom and WPS 365 connectors use cli.',
        } } : {}),
        selectedConnections: getContext?.()?.conversationId ? connectionBindings(getContext()!.conversationId) : [], waitingObjective: getContext?.()?.conversationId ? getActiveConnectionWait(getContext()!.conversationId)?.summary : undefined });
    },
  };
  const describeTool: AgentTool<typeof ToolDescribeSchema, Record<string, unknown>> = {
    name: EXTERNAL_TOOL_NAMES.describe,
    label: '📋 External Tool Contract',
    description: 'Load exact contracts for up to three external tools returned by xopc_tool_search.',
    parameters: ToolDescribeSchema,
    async execute(_toolCallId, params) {
      params.toolRefs.forEach(assertLegacyRef);
      const result = await service.describe(params.toolRefs);
      return textResult({ ...result, ...(result.notFound.length ? { instruction: 'These exact tool contracts are unavailable. Do not execute them, invent revisions, or reconnect the account. Use a different available tool or explain the capability failure.' } : {}) });
    },
  };
  const executeTool: AgentTool<typeof ToolExecuteSchema, Record<string, unknown>> = {
    name: EXTERNAL_TOOL_NAMES.execute,
    label: '▶️ External Tool Execute',
    description: 'Execute one external tool using its exact reference, contract revision, and validated arguments.',
    parameters: ToolExecuteSchema,
    async execute(toolCallId, params, signal, onUpdate) {
      const conversationId = getExecutionConversationId?.() ?? getContext?.()?.conversationId;
      const request = conversationId ? personalRequestForExecution(conversationId) : undefined;
      if (!request && conversationId && isXopcDatabaseOpen() && getSessionMetadata(conversationId)?.customData?.personalReadRequestId) {
        throw new Error('Personal request is no longer active');
      }
      if (request) {
        if (['cancelled', 'failed', 'completed'].includes(request.state)) throw new Error('Personal request is no longer active');
        if (!request.accountId || params.arguments?.xopcAccountId !== request.accountId) throw new Error('Use the selected Personal request account');
        const composio = parseExternalToolRef(params.toolRef, 'composio');
        const cli = parseExternalToolRef(params.toolRef, 'cli');
        const config = getConfig?.();
        const connectorId = composio ? getConnectorInstallation(composio.namespace)?.connectorId
          : cli && config ? listConnectorInstances(config).find(instance => instance.instanceId === cli.namespace)?.connectorId : undefined;
        if (connectorId !== request.connectorId) throw new Error('Use only the selected Personal request connector');
        if (composio && !listConnectorActionMetadata(connectorId).some(action => action.actionId === composio.toolName
          && action.scope === 'read' && action.curated)) throw new Error('Personal requests permit only curated read operations');
        const account = getConnectorAccount(request.accountId);
        const connection = account?.currentConnectionId ? getConnectorConnection(account.currentConnectionId) : undefined;
        if (!connection || connection.status !== 'active' || (connection.expiresAt && Date.parse(connection.expiresAt) <= Date.now())) {
          const { requirePersonalWorkerConnection, publishPersonalRequest } = await import('../../personal-agent/request-service.js');
          const waiting = requirePersonalWorkerConnection(conversationId!);
          publishPersonalRequest(waiting);
          return textResult({ status: 'waiting_connection', requestId: request.requestId,
            instruction: 'Stop this turn. The selected account must be reconnected in the main chat; this Task will resume automatically.' });
        }
      }
      const result = await service.execute({
        ...params,
        ...(request ? { readOnly: true } : {}),
        context: { toolCallId, signal, onUpdate },
      });
      return {
        ...result,
        details: {
          ...(result.details ?? {}),
          delegatedToolRef: params.toolRef,
          delegatedToolRevision: params.revision,
        },
      };
    },
  };
  const nativeExecute = executeTool.execute.bind(executeTool);
  executeTool.execute = async (id, params, signal, update) => {
    assertLegacyRef(params.toolRef);
    return nativeExecute(id, params, signal, update);
  };
  bindExternalToolRegistry(executeTool, { service, nativeSources, execute: nativeExecute, executorConfig });
  const requireSchema = Type.Object({
    requirements: Type.Array(Type.Object({
      candidateRef: Type.String(),
      accountId: Type.Optional(Type.String()),
      accountSelector: Type.Optional(Type.String({ maxLength: 100 })),
    }), { minItems: 1, maxItems: 5 }),
    purpose: Type.String({ minLength: 1, maxLength: 1000 }),
    checkpoint: Type.Object({
      completedSteps: Type.Array(Type.String({ maxLength: 500 }), { maxItems: 20 }),
      pendingSteps: Type.Array(Type.String({ maxLength: 500 }), { minItems: 1, maxItems: 20 }),
      timeRange: Type.Optional(Type.Object({ from: Type.String(), to: Type.String(), timezone: Type.String(), expression: Type.String() })),
    }, { description: 'Preserve completed work, remaining work, and absolute dates resolved from the original request. Never include credentials.' }),
  });
  const requireTool: AgentTool<typeof requireSchema, Record<string, unknown>> = {
    name: EXTERNAL_TOOL_NAMES.requireConnection, label: 'Connect app', parameters: requireSchema,
    description: 'Request a connectionCandidates or installCandidates entry returned by xopc_tool_search. Explain the need once before calling. This pauses the current objective and displays one action area above the input. Never invent a candidate reference, return OAuth URLs, or repeat a skipped request. If another objective is waiting, ask the user to continue or cancel it first.',
    async execute(_id, params) {
      const context = getContext?.();
      if (!context) throw new Error('No active conversation.');
      const range = params.checkpoint.timeRange;
      if (range && (!Number.isFinite(Date.parse(range.from)) || !Number.isFinite(Date.parse(range.to)) || Date.parse(range.from) >= Date.parse(range.to))) throw new Error('Provide a valid absolute time range.');
      if (range) new Intl.DateTimeFormat('en', { timeZone: range.timezone }).format();
      const principal = connectorPrincipalForSession(context.conversationId);
      if (!principal.isLocalOwner) throw new Error('Connection recovery is available in the owner chat.');
      const selected = connectionBindings(context.conversationId);
      if (params.requirements.every(item => {
        return selected.some(need => {
          if (need.target.type === 'connector') {
            return need.target.connectorId === item.candidateRef
              && Boolean(need.connectionId) && (!item.accountId || item.accountId === need.accountId)
              && (!item.accountSelector || item.accountSelector === need.accountSelector)
              && listConnectorConnections({ principalId: principal.principalId, connectorId: need.target.connectorId })
                .some(connection => connection.id === need.connectionId && connection.status === 'active');
          }
          const storeTarget = parseStoreConnectorCandidateRef(item.candidateRef);
          return Boolean(storeTarget && need.target.packageName === storeTarget.packageName
            && need.target.version === storeTarget.version && need.connectionId);
        });
      })) {
        return textResult({ status: 'already_connected', selectedConnections: selected,
          instruction: 'These accounts were already checked for this objective. Missing tool contracts are a tool availability problem. Do not request authorization again or invent a revision. Explain the unavailable capability and stop retrying the same tools.' });
      }
      const result = requireSessionConnection({ conversationId: context.conversationId,
        principalId: principal.principalId, agentId: principal.agentId ?? 'main', summary: params.purpose, checkpoint: params.checkpoint,
        needs: await Promise.all(params.requirements.map(async item => {
          const storeRef = parseStoreConnectorCandidateRef(item.candidateRef);
          const config = getConfig?.();
          const plan = storeRef && config
            ? await getStoreConnectorInstallPlan(config, storeRef.packageName, storeRef.version)
            : undefined;
          if (plan && !plan.definition.provenance) {
            throw new Error('Store Connector provenance is unavailable.');
          }
          const need = plan ? {
            key: item.candidateRef,
            target: {
              type: 'store-connector' as const,
              packageName: plan.packageName,
              connectorId: plan.definition.id,
              version: plan.version,
              sha256: plan.definition.provenance.sha256,
              reviewHash: plan.reviewHash,
              description: plan.definition.description,
            },
            label: plan.definition.displayName,
            capabilities: plan.definition.capabilities,
          } : resolveConnectionCandidate(item.candidateRef);
          if (item.accountId && need.target.type !== 'connector') throw new Error('This install candidate does not support account selection.');
          if (item.accountId && need.target.type === 'connector'
            && !listConnectorConnections({ principalId: principal.principalId, connectorId: need.target.connectorId }).some(connection => connection.accountId === item.accountId)) throw new Error('Unknown account for this app.');
          return { ...need, accountId: item.accountId, accountSelector: item.accountSelector,
            key: need.target.type === 'connector' ? `${need.target.connectorId}:${item.accountId ?? item.accountSelector ?? 'default'}` : need.key };
        })),
      });
      publishConnectionWait(context.conversationId);
      return textResult(result);
    },
  };
  const reviseSchema = Type.Object({
    action: Type.Union([Type.Literal('update'), Type.Literal('cancel')]),
    objective: Type.Optional(Type.String({ minLength: 1, maxLength: 4000 })),
  });
  const reviseTool: AgentTool<typeof reviseSchema, Record<string, unknown>> = {
    name: EXTERNAL_TOOL_NAMES.updateConnectionObjective, label: 'Update waiting objective', parameters: reviseSchema,
    description: 'Use when the user supplements or explicitly cancels the objective waiting for a connection. Update with the complete revised objective including the requested time range. For unrelated work leave the waiting objective unchanged. Cancellation does not disconnect the account.',
    async execute(_id, params) {
      const context = getContext?.();
      if (!context) throw new Error('No active conversation.');
      if (params.action === 'update' && !params.objective) throw new Error('The revised objective is required.');
      reviseCurrentConnectionObjective(context.conversationId, params.action === 'update' ? params.objective : undefined);
      return textResult({ status: params.action === 'update' ? 'updated' : 'cancelled' });
    },
  };
  return [searchTool, describeTool, executeTool,
    setXopcToolMetadata(requireTool, { exposure: 'model-only' }),
    setXopcToolMetadata(reviseTool, { exposure: 'model-only' })];
}
