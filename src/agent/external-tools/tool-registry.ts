import type { AgentTool } from '@earendil-works/pi-agent-core';

import type { ExternalToolService } from './service.js';
import type { ExternalToolSource } from './types.js';
import type { ToolExecutorConfig } from '../tools/executor.js';

export interface ExternalToolRegistry {
  service: ExternalToolService;
  nativeSources: readonly ExternalToolSource[];
  execute: AgentTool['execute'];
  executorConfig?: Partial<ToolExecutorConfig>;
  subscribeInvalidation?: (conversationId: string, toolRef: string, listener: () => void) => () => void;
}

const registryKey = Symbol('xopc.externalToolRegistry');

/** Keep the host executor available without exposing its registry in model declarations. */
export function bindExternalToolRegistry(tool: AgentTool, registry: ExternalToolRegistry): void {
  Object.assign(tool, { [registryKey]: registry });
}

export function getExternalToolRegistry(tools: readonly AgentTool[]): ExternalToolRegistry | undefined {
  for (const tool of tools) {
    const registry: ExternalToolRegistry | undefined = Reflect.get(tool, registryKey);
    if (registry) return registry;
  }
  return undefined;
}
