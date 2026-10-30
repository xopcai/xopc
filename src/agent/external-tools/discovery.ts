import type { Config } from '../../config/schema.js';
import { searchStoreConnectorInstallCandidates } from '../../capabilities/store-connector.js';
import { connectionCandidates } from '../../connectors/connection-candidates.js';
import { connectionBindings, getActiveConnectionWait } from '../../storage/sqlite/connection-wait-repository.js';
import type { ExternalToolService } from './service.js';
import { EXTERNAL_TOOL_SOURCES, type ExternalToolSource, type ExternalToolTurnContext } from './types.js';
import type { PersonalRequest } from '../../personal-agent/request-repository.js';

export type ExternalDiscoveryParams = { query: string; limit?: number; sources?: ExternalToolSource[]; signal?: AbortSignal; timeoutMs?: number };

/** Discover capabilities without activating tools or granting execution permissions. */
export async function discoverExternalTools(deps: {
  service: ExternalToolService;
  nativeSources: readonly ExternalToolSource[];
  getContext?: () => ExternalToolTurnContext | null;
  getConfig?: () => Config | undefined;
  getRequest: () => PersonalRequest | undefined;
}, params: ExternalDiscoveryParams) {
  const { service, nativeSources, getContext, getConfig } = deps;
  const gatewaySources = EXTERNAL_TOOL_SOURCES.filter(source => !nativeSources.includes(source));
  const request = deps.getRequest();
  const selectedSources = new Set<string>(params.sources ?? []);
  const excludedSources = selectedSources.size ? EXTERNAL_TOOL_SOURCES.filter(source => !selectedSources.has(source)) : [];
  if (params.sources?.length && params.sources.every(source => nativeSources.includes(source))) {
    return { tools: [], connectionCandidates: [], installCandidates: [], unavailableSources: [], instruction: 'Use tool_search for native tools.' };
  }
  const result = await service.search({ ...params, sources: (params.sources?.length ? params.sources : gatewaySources)
    .filter(source => !nativeSources.includes(source)) });
  const currentRequest = deps.getRequest();
  if (request && (currentRequest?.requestId !== request.requestId || currentRequest.accountId !== request.accountId
    || currentRequest.connectorId !== request.connectorId)) throw new Error('Personal request execution identity changed');
  const candidates = [...(request ? [] : result.connectionCandidates), ...(request ? [] : connectionCandidates(params.query))]
    .filter((candidate, index, all) => all.findIndex(item => item.candidateRef === candidate.candidateRef) === index)
    .slice(0, params.limit ?? 8);
  let installCandidates: Awaited<ReturnType<typeof searchStoreConnectorInstallCandidates>> = [];
  let installCatalogError: string | undefined;
  const config = getConfig?.();
  if (!request && !params.sources?.length && result.tools.length === 0 && candidates.length === 0 && config) {
    try {
      installCandidates = await searchStoreConnectorInstallCandidates(config, params.query, params.limit ?? 5);
    } catch (error) {
      installCatalogError = error instanceof Error ? error.message : String(error);
    }
  }
  return { ...result, connectionCandidates: candidates, installCandidates,
    ...(result.tools.length === 0 && (candidates.length > 0 || installCandidates.length > 0) ? {
      instruction: 'No executable tool matched this search. This alone does not prove the account is disconnected. Retry without restrictive sources and inspect the returned account state. If authorization or account selection is actually required, call xopc_require_connection with an exact candidateRef from this result; the host owns selection, authorization and automatic continuation. Do not ask the user whether to perform an already requested read, or to reply continue after authorization. Do not fall back to browser automation unless the user explicitly asked for browser use or skips the connection.',
    } : {}),
    ...(result.tools.length > 0 ? {
      instruction: 'Describe the relevant tool contracts and execute the requested read using the available authorized account. The user request already authorizes these reads; do not ask for another confirmation. Respect the exact contracts and host permission checks. Hand off to the user only when a required authorization, ambiguous account choice or essential missing decision cannot be resolved from existing context.',
    } : {}),
    ...(installCatalogError ? { installCatalogError } : {}),
    ...(excludedSources.length ? { searchScope: {
      excludedSources,
      instruction: 'This search excluded these sources. Results from other apps do not establish that the requested app is unavailable. Retry without sources before declaring a capability unavailable or requesting authorization. Feishu/Lark, WeCom and WPS 365 connectors use cli.',
    } } : {}),
    selectedConnections: !request && getContext?.()?.conversationId ? connectionBindings(getContext()!.conversationId) : [], waitingObjective: !request && getContext?.()?.conversationId ? getActiveConnectionWait(getContext()!.conversationId)?.summary : undefined,
    ...(request ? { selectedAccountId: request.accountId, instruction: 'Use only this request connector and selected account. Describe matching contracts before execution. If the selected account needs authorization, use personal_request_connection; the main chat owns reconnection and automatic continuation.' } : {}) };
}

export type ExternalDiscoveryResult = Awaited<ReturnType<typeof discoverExternalTools>>;
