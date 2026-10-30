import type { Config } from '../../config/schema.js';
import type { ExtensionHookRunner } from '../../extensions/index.js';
import type { ExtensionRegistry } from '../../extensions/types/index.js';
import type { MemoryManager } from '../memory/manager.js';
import type { EndpointToolRuntime } from '../../endpoint-tools/index.js';
import type { ToolExecutorConfig } from '../tools/executor.js';
import { CliToolProvider } from './cliProvider.js';
import { ComposioToolProvider } from './composio-provider.js';
import { ExtensionToolProvider } from './extension-provider.js';
import { createExternalToolGatewayTools } from './gateway-tools.js';
import { MemoryToolProvider } from './memory-provider.js';
import { EndpointToolProvider } from './endpoint-provider.js';
import type { ExternalToolProvider, ExternalToolTurnContext } from './types.js';
import { resolveEffectiveAgentConfigForAgent, resolveEffectiveAgentConfigForSession } from '../../config/agent-profile.js';
import { withExternalReadPolicy } from './read-policy.js';
import { getEmbeddedExecutionSession } from '../embedded/execution-context.js';
import { getExternalToolRegistry } from './tool-registry.js';
import { parseExternalToolRef } from './refs.js';

export interface DefaultExternalToolGatewayDeps {
  workspace: string;
  getConfig: () => Config | undefined;
  getCurrentContext: () => ExternalToolTurnContext | null;
  endpointTools?: EndpointToolRuntime;
  agentId?: string;
  extensionRegistry?: ExtensionRegistry;
  disabledTools?: Set<string>;
  toolAllowlist?: readonly string[];
  hookRunner?: ExtensionHookRunner;
  toolExecutorConfig?: Partial<ToolExecutorConfig>;
  getMemoryManager?: () => MemoryManager;
  canAccessMemory: () => boolean;
}

export function createDefaultExternalToolGatewayTools(deps: DefaultExternalToolGatewayDeps) {
  const getConversationId = () => getEmbeddedExecutionSession() ?? deps.getCurrentContext()?.conversationId;
  const providers: ExternalToolProvider[] = [
    new CliToolProvider({ getConfig: deps.getConfig, getCurrentContext: deps.getCurrentContext, agentId: deps.agentId }),
    new ComposioToolProvider({
      getConfig: deps.getConfig,
      getCurrentContext: deps.getCurrentContext,
      agentId: deps.agentId,
      hookRunner: deps.hookRunner,
    }),
    new ExtensionToolProvider({
      registry: deps.extensionRegistry,
      disabledTools: deps.disabledTools,
      getConversationId,
      hookRunner: deps.hookRunner,
      toolExecutorConfig: deps.toolExecutorConfig,
    }),
    new MemoryToolProvider({
      getMemoryManager: deps.getMemoryManager,
      disabledTools: deps.disabledTools,
      getConversationId,
      canAccess: deps.canAccessMemory,
      hookRunner: deps.hookRunner,
      toolExecutorConfig: deps.toolExecutorConfig,
    }),
  ];
  if (deps.endpointTools) {
    providers.push(new EndpointToolProvider({
      runtime: deps.endpointTools,
      getCurrentContext: () => {
        const conversationId = getConversationId();
        if (!conversationId) return null;
        const context = deps.getCurrentContext();
        return context?.conversationId === conversationId ? context : {
          conversationId, channel: 'internal', chatId: conversationId,
          origin: { type: 'system', source: 'internal' },
        };
      },
    }));
  }
  const tools = createExternalToolGatewayTools(providers.map(provider => withExternalReadPolicy(provider, toolRef => {
    const config = deps.getConfig();
    if (!config) return undefined;
    const conversationId = getConversationId();
    const profile = conversationId ? resolveEffectiveAgentConfigForSession(conversationId)
      : deps.agentId ? resolveEffectiveAgentConfigForAgent(deps.agentId) : resolveEffectiveAgentConfigForSession(undefined);
    return profile.config.tools[toolRef];
  })), deps.getCurrentContext, deps.getConfig, getConversationId, ['endpoint', 'extension', 'memory'], deps.toolExecutorConfig);
  const registry = getExternalToolRegistry(tools);
  if (registry) {
    const native = !deps.disabledTools?.has('tool_search');
    registry.discovery = { native, connectors: native && !deps.disabledTools?.has('xopc_tool_search')
      && (!deps.toolAllowlist || deps.toolAllowlist.includes('tool_search') || deps.toolAllowlist.includes('xopc_tool_search')) };
  }
  if (registry && deps.endpointTools) {
    const endpoints = deps.endpointTools;
    registry.subscribeInvalidation = (conversationId, ref, listener) => {
      const parsed = parseExternalToolRef(ref, 'endpoint');
      if (!parsed) return () => {};
      const releaseEndpoint = endpoints.registry.onChange((id, reason) => { if (id === parsed?.namespace) listener(reason ?? 'connection'); });
      const principalId = endpoints.registry.get(parsed.namespace)?.principalId;
      const releasePrincipal = principalId
        ? endpoints.registry.onPrincipalRevoked(principalId, () => listener('authorization')) : () => {};
      const releaseBinding = endpoints.bindings.onChange(id => { if (id === conversationId) listener('authorization'); });
      return () => { releaseEndpoint(); releaseBinding(); releasePrincipal(); };
    };
  }
  return tools;
}

export { ExternalToolService } from './service.js';
export { EXTERNAL_TOOL_NAMES } from './gateway-tools.js';
export type * from './types.js';
