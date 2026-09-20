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
import { McpToolProvider } from './mcp-provider.js';
import { MemoryToolProvider } from './memory-provider.js';
import { EndpointToolProvider } from './endpoint-provider.js';
import type { ExternalToolProvider, ExternalToolTurnContext } from './types.js';
import { resolveEffectiveAgentConfigForAgent, resolveEffectiveAgentConfigForSession } from '../../config/agent-profile.js';
import { withExternalReadPolicy } from './read-policy.js';

export interface DefaultExternalToolGatewayDeps {
  workspace: string;
  getConfig: () => Config | undefined;
  getCurrentContext: () => ExternalToolTurnContext | null;
  endpointTools?: EndpointToolRuntime;
  agentId?: string;
  extensionRegistry?: ExtensionRegistry;
  disabledTools?: Set<string>;
  hookRunner?: ExtensionHookRunner;
  toolExecutorConfig?: Partial<ToolExecutorConfig>;
  getMemoryManager?: () => MemoryManager;
  canAccessMemory: () => boolean;
}

export function createDefaultExternalToolGatewayTools(deps: DefaultExternalToolGatewayDeps) {
  const providers: ExternalToolProvider[] = [
    new CliToolProvider({ getConfig: deps.getConfig, getCurrentContext: deps.getCurrentContext, agentId: deps.agentId }),
    new McpToolProvider({
      workspace: deps.workspace,
      getConfig: deps.getConfig,
      getConversationId: () => deps.getCurrentContext()?.conversationId,
      agentId: deps.agentId,
      hookRunner: deps.hookRunner,
    }),
    new ComposioToolProvider({
      getConfig: deps.getConfig,
      getCurrentContext: deps.getCurrentContext,
      agentId: deps.agentId,
      hookRunner: deps.hookRunner,
    }),
    new ExtensionToolProvider({
      registry: deps.extensionRegistry,
      disabledTools: deps.disabledTools,
      getConversationId: () => deps.getCurrentContext()?.conversationId,
      hookRunner: deps.hookRunner,
      toolExecutorConfig: deps.toolExecutorConfig,
    }),
    new MemoryToolProvider({
      getMemoryManager: deps.getMemoryManager,
      disabledTools: deps.disabledTools,
      getConversationId: () => deps.getCurrentContext()?.conversationId,
      canAccess: deps.canAccessMemory,
      hookRunner: deps.hookRunner,
      toolExecutorConfig: deps.toolExecutorConfig,
    }),
  ];
  if (deps.endpointTools) {
    providers.push(new EndpointToolProvider({
      runtime: deps.endpointTools,
      getCurrentContext: deps.getCurrentContext,
    }));
  }
  return createExternalToolGatewayTools(providers.map(provider => withExternalReadPolicy(provider, toolRef => {
    const config = deps.getConfig();
    if (!config) return undefined;
    const conversationId = deps.getCurrentContext()?.conversationId;
    const profile = conversationId ? resolveEffectiveAgentConfigForSession(config, conversationId)
      : deps.agentId ? resolveEffectiveAgentConfigForAgent(config, deps.agentId) : resolveEffectiveAgentConfigForSession(config, undefined);
    return profile.config.tools[toolRef];
  })), deps.getCurrentContext);
}

export { ExternalToolService } from './service.js';
export { EXTERNAL_TOOL_NAMES } from './gateway-tools.js';
export type * from './types.js';
