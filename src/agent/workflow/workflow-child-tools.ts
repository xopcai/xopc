import type { AgentTool } from '@earendil-works/pi-agent-core';

import type { BuildChildToolsOptions } from '../child-agent-factory.js';
import { AgentToolsFactory } from '../tools/factory.js';

/** Builds the tool set for workflow child agents (wired from gateway to avoid cycles). */
export function buildWorkflowChildTools(childOptions: BuildChildToolsOptions): AgentTool<any, any>[] {
  const childFactory = new AgentToolsFactory({
    workspace: childOptions.workspace,
    bus: childOptions.bus,
    getCurrentContext: () => null,
    getConfig: childOptions.getConfig,
    getPrimaryModel: () => childOptions.model,
    toolExecutorConfig: childOptions.toolExecutorConfig,
  });
  return childFactory.createAllTools({
    workspace: childOptions.workspace,
    getPrimaryModel: () => childOptions.model,
    disabledTools: new Set(['extensions']),
  });
}
