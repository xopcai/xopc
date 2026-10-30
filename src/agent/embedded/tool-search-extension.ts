import type { AgentTool } from '@earendil-works/pi-agent-core';
import { createToolSearchExtension, type ExtensionFactory } from '@earendil-works/pi-coding-agent';

import type { ExternalDiscoveryResult } from '../external-tools/discovery.js';
import { getExternalToolRegistry, type ExternalToolRegistry } from '../external-tools/tool-registry.js';
import { deferredToolContract, getXopcToolMetadata } from './tool-metadata.js';

export const TOOL_DISCOVERY_STATE = 'xopc-tool-discovery';

/** One model-facing discovery entry; execution and connection permissions remain host-owned. */
export function createXopcToolSearchExtension(tools: readonly AgentTool[], options: {
  nativeDiscovery?: boolean;
  externalDiscovery?: boolean;
  registry?: ExternalToolRegistry;
  externalTimeoutMs?: number;
} = {}): ExtensionFactory {
  const deferred = tools.filter(tool => getXopcToolMetadata(tool)?.exposure === 'deferred');
  const registry = options.externalDiscovery === false ? undefined : options.registry ?? getExternalToolRegistry(tools);
  const nativeDiscovery = options.nativeDiscovery !== false;
  return pi => {
    const setActiveTools = (names: string[]) => {
      pi.setActiveTools(names);
      if (!nativeDiscovery) return;
      const active = new Set(pi.getActiveTools());
      pi.appendEntry(TOOL_DISCOVERY_STATE, { loaded: deferred.filter(tool => active.has(tool.name))
        .map(tool => ({ name: tool.name, contract: deferredToolContract(tool) })) });
    };
    return createToolSearchExtension()({ ...pi,
      registerTool(definition) {
        pi.registerTool({ ...definition,
          description: 'Search for tools and connector capabilities using concise capability keywords. loadedTools are available by name from the next model call. externalTools require xopc_tool_describe, then xopc_tool_execute with the exact revision. Connection and install candidates are recovery options, not executable tools or proof of missing authorization. Use xopc_require_connection only when authorization, installation or account selection is actually required; Personal request workers use personal_request_connection. Source errors do not mean a capability is unavailable. Searches never grant permissions.',
          executionMode: 'sequential',
          async execute(id, params, signal, update, context) {
            const input = params as { limit?: number; query: string };
            const limit = input.limit ?? 8;
            if (!Number.isInteger(limit) || limit < 1 || limit > 20 || !input.query?.trim() || input.query.length > 2000) {
              throw new Error('Tool search requires a nonempty query of at most 2000 characters and a limit from 1 to 20');
            }
            signal?.throwIfAborted();
            // Rank within each directory: pi BM25 scores and connector scores are not comparable.
            const nativeLimit = nativeDiscovery ? registry ? Math.max(1, Math.floor(limit / 2)) : limit : 0;
            const externalLimit = nativeDiscovery ? Math.max(1, limit - nativeLimit) : limit;
            const externalSearch = registry ? boundedSearch(() => registry.search({ query: input.query, limit: externalLimit, signal, timeoutMs: 4000 }),
              options.externalTimeoutMs ?? 8000, signal) : Promise.resolve(undefined);
            const result = nativeDiscovery
              ? await definition.execute(id, { ...params, limit: nativeLimit }, signal, update, context)
              : { content: [], details: { loaded: [] as string[] } };
            const external = await externalSearch;
            signal?.throwIfAborted();
            const loaded = (result.details as { loaded?: string[] } | undefined)?.loaded ?? [];
            const queryNames = new Set(input.query.match(/[\w.:-]+/g));
            const active = new Set(pi.getActiveTools());
            const alreadyLoaded = nativeDiscovery ? deferred.filter(tool => active.has(tool.name)
              && !loaded.includes(tool.name) && queryNames.has(tool.name)).map(tool => tool.name) : [];
            const externalTools = (external?.result?.tools ?? []).slice(0, Math.max(0, limit - loaded.length));
            if (externalTools.length) {
              // The contracts must be callable without a second discovery round trip.
              setActiveTools([...active, 'xopc_tool_describe', 'xopc_tool_execute']);
            }
            const all = new Map(pi.getAllTools().map(tool => [tool.name, tool]));
            const payload = {
              loadedTools: loaded.map(name => ({ name, description: all.get(name)?.description, nextAction: 'call' })),
              alreadyLoaded,
              externalTools: externalTools.map(tool => ({ ...tool, nextAction: 'describe' })),
              connectionCandidates: external?.result?.connectionCandidates ?? [],
              installCandidates: external?.result?.installCandidates ?? [],
              selectedConnections: external?.result?.selectedConnections ?? [],
              selectedAccountId: external?.result?.selectedAccountId,
              waitingObjective: external?.result?.waitingObjective,
              sourceErrors: [
                ...(external?.result?.sourceErrors ?? []),
                ...(external?.error ? [{ source: 'connectors', message: external.error }] : []),
                ...(external?.result?.installCatalogError ? [{ source: 'store', message: external.result.installCatalogError }] : []),
              ],
              unavailableSources: external?.result?.unavailableSources ?? [],
              scope: { native: nativeDiscovery, connectors: Boolean(registry),
                ...(nativeDiscovery ? {} : { restriction: 'Only the selected Personal request connector, account and curated reads are discoverable.' }) },
              instruction: [
                nativeDiscovery ? (result.content as { type: string; text?: string }[]).filter(block => block.type === 'text').map(block => block.text).join('\n') : '',
                alreadyLoaded.length ? `Already loaded: ${alreadyLoaded.join(', ')}. Call these tools directly.` : '',
                external?.result?.instruction ?? '',
                'loadedTools are declared from the next model call; externalTools are references and must be described before execution. No matches alone do not prove missing authorization.',
              ].filter(Boolean).join('\n'),
            };
            return { content: [{ type: 'text', text: JSON.stringify(payload) }], details: { ...payload, loaded } } as Awaited<ReturnType<typeof definition.execute>>;
          },
        });
      },
      setActiveTools,
    });
  };
}

/** Bound directory latency without cancelling another source or executing any operation. */
async function boundedSearch(search: () => Promise<ExternalDiscoveryResult>, timeoutMs: number, signal?: AbortSignal): Promise<{
  result?: ExternalDiscoveryResult; error?: string;
}> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(search).then(result => ({ result })),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Connector discovery timed out; retry before declaring the capability unavailable')), timeoutMs);
        onAbort = () => reject(signal?.reason ?? new Error('Tool search aborted'));
        signal?.addEventListener('abort', onAbort, { once: true });
      }),
    ]);
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
    if (onAbort) signal?.removeEventListener('abort', onAbort);
  }
}
