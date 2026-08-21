import type { Config } from '../../config/schema.js';
import type { ExtensionHookRunner } from '../../extensions/index.js';
import type { ExtensionRegistry } from '../../extensions/types/index.js';
import type { MemoryManager } from '../memory/manager.js';
import type { ToolExecutorConfig } from '../tools/executor.js';
import { ComposioToolProvider } from './composio-provider.js';
import { ExtensionToolProvider } from './extension-provider.js';
import { createExternalToolGatewayTools } from './gateway-tools.js';
import { McpToolProvider } from './mcp-provider.js';
import { MemoryToolProvider } from './memory-provider.js';

export interface DefaultExternalToolGatewayDeps {
  workspace: string;
  getConfig: () => Config | undefined;
  getCurrentContext: () => { channel: string; chatId: string; sessionKey: string } | null;
  agentId?: string;
  extensionRegistry?: ExtensionRegistry;
  disabledTools?: Set<string>;
  hookRunner?: ExtensionHookRunner;
  toolExecutorConfig?: Partial<ToolExecutorConfig>;
  getMemoryManager?: () => MemoryManager;
}

export function createDefaultExternalToolGatewayTools(deps: DefaultExternalToolGatewayDeps) {
  return createExternalToolGatewayTools([
    new McpToolProvider({
      workspace: deps.workspace,
      getConfig: deps.getConfig,
      getSessionKey: () => deps.getCurrentContext()?.sessionKey,
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
      getSessionKey: () => deps.getCurrentContext()?.sessionKey,
      hookRunner: deps.hookRunner,
      toolExecutorConfig: deps.toolExecutorConfig,
    }),
    new MemoryToolProvider({
      getMemoryManager: deps.getMemoryManager,
      disabledTools: deps.disabledTools,
      getSessionKey: () => deps.getCurrentContext()?.sessionKey,
      hookRunner: deps.hookRunner,
      toolExecutorConfig: deps.toolExecutorConfig,
    }),
  ]);
}

export { ExternalToolService } from './service.js';
export { EXTERNAL_TOOL_NAMES } from './gateway-tools.js';
export type * from './types.js';
