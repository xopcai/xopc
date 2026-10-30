import type { Config } from '../../config/schema.js';
import { listConnectorInstances } from '../../connectors/instances.js';
import { assertPersonalRequestAccountAccess } from '../../personal-agent/request-access.js';
import { personalRequestForExecution, type PersonalRequest } from '../../personal-agent/request-repository.js';
import { isXopcDatabaseOpen } from '../../storage/sqlite/connection.js';
import { getConnectorInstallation, listConnectorActionMetadata } from '../../storage/sqlite/connector-repository.js';
import { getSessionMetadata } from '../../storage/sqlite/session-repository.js';
import { parseExternalToolRef } from './refs.js';
import type { ExternalToolDescriptor, ExternalToolProvider } from './types.js';

/** Read scope follows persisted request identity, including cancelled or detached workers. */
export function personalRequestToolScope(conversationId?: string): PersonalRequest | undefined {
  const request = conversationId ? personalRequestForExecution(conversationId) : undefined;
  if (!request && conversationId && isXopcDatabaseOpen()
    && getSessionMetadata(conversationId)?.customData?.personalReadRequestId) {
    throw new Error('Personal request is no longer active');
  }
  if (request) assertPersonalRequestAccountAccess(request);
  return request;
}

/** Apply the same connector, account and curated-read boundary before search ranking and describe. */
export function scopePersonalRequestProvider(
  provider: ExternalToolProvider,
  getRequest: () => PersonalRequest | undefined,
  getConfig?: () => Config | undefined,
): ExternalToolProvider {
  const describe = async (ref: string): Promise<ExternalToolDescriptor | undefined> => {
    const request = getRequest();
    if (!request) return provider.describe(ref);
    if (!request.accountId) throw new Error('Personal request requires a selected account');
    const parsed = parseExternalToolRef(ref, provider.source);
    if (!parsed || !['cli', 'composio'].includes(provider.source)) return undefined;
    const config = getConfig?.();
    const connectorId = provider.source === 'composio' ? getConnectorInstallation(parsed.namespace)?.connectorId
      : config ? listConnectorInstances(config).find(instance => instance.instanceId === parsed.namespace)?.connectorId : undefined;
    if (connectorId !== request.connectorId) return undefined;
    if (provider.source === 'composio' && !listConnectorActionMetadata(connectorId).some(action =>
      action.actionId === parsed.toolName && action.scope === 'read' && action.curated)) return undefined;
    const descriptor = await provider.describe(ref, { connectorId: request.connectorId, accountId: request.accountId });
    // Recheck after asynchronous schema discovery, before exposing any contract.
    const current = getRequest();
    if (!current || current.accountId !== request.accountId || current.connectorId !== request.connectorId
      || current.requestId !== request.requestId) throw new Error('Personal request execution identity changed');
    if (!descriptor || descriptor.readOnly !== true) return undefined;
    return { ...descriptor,
      description: `${descriptor.summary}\nUse only selected account ${request.accountId}.`,
      inputSchema: { ...descriptor.inputSchema,
        properties: { ...(descriptor.inputSchema.properties as Record<string, unknown>),
          xopcAccountId: { type: 'string', const: request.accountId } },
        required: [...new Set([...(descriptor.inputSchema.required as string[] ?? []), 'xopcAccountId'])] },
    };
  };
  return {
    source: provider.source,
    async search(query) {
      const request = getRequest();
      if (!request) return provider.search(query);
      if (!request.accountId) throw new Error('Personal request requires a selected account');
      if (!['cli', 'composio'].includes(provider.source)) return [];
      const hits = await provider.search(query, { connectorId: request.connectorId, accountId: request.accountId });
      const scoped = await Promise.all(hits.map(async hit => {
        const descriptor = await describe(hit.toolRef);
        return descriptor ? { ...hit, summary: descriptor.summary } : undefined;
      }));
      return scoped.filter(hit => hit !== undefined);
    },
    async connectionCandidates(query) {
      return getRequest() ? [] : await provider.connectionCandidates?.(query) ?? [];
    },
    describe,
    execute: (ref, args, approvalId, context) => provider.execute(ref, args, approvalId, context),
  };
}
