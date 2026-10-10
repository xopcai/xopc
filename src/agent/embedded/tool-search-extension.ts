import type { AgentTool } from '@earendil-works/pi-agent-core';
import { createToolSearchExtension, type ExtensionFactory } from '@earendil-works/pi-coding-agent';

import { deferredToolContract, getXopcToolMetadata } from './tool-metadata.js';

export const TOOL_DISCOVERY_STATE = 'xopc-tool-discovery';

/** xopc deliberately excludes pi system declarations from SQLite; retain only discovery state. */
export function createXopcToolSearchExtension(tools: readonly AgentTool[]): ExtensionFactory {
  const deferred = tools.filter(tool => getXopcToolMetadata(tool)?.exposure === 'deferred');
  return pi => createToolSearchExtension()({ ...pi,
    registerTool(definition) {
      pi.registerTool({ ...definition, async execute(id, params, signal, update, context) {
        const input = params as { limit?: number; query?: string };
        if ((input.limit ?? 8) > 20 || (input.query?.length ?? 0) > 2000) throw new Error('Tool search permits at most 20 matches and 2000 query characters');
        return definition.execute(id, params, signal, update, context);
      } });
    },
    setActiveTools(names) {
      pi.setActiveTools(names);
      const active = new Set(pi.getActiveTools());
      pi.appendEntry(TOOL_DISCOVERY_STATE, { loaded: deferred.filter(tool => active.has(tool.name))
        .map(tool => ({ name: tool.name, contract: deferredToolContract(tool) })) });
    },
  });
}
