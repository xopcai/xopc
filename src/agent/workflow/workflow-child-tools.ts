import type { AgentTool } from '@earendil-works/pi-agent-core';

import type { BuildChildToolsOptions } from '../child-agent-factory.js';
import { AgentToolsFactory } from '../tools/factory.js';
import { resolveEffectiveAgentProfile } from '../../config/agent-profile.js';

/** Builds the tool set for workflow child agents (wired from gateway to avoid cycles). */
export function buildWorkflowChildTools(childOptions: BuildChildToolsOptions): AgentTool<any, any>[] {
  const config = childOptions.getConfig();
  if (config && !childOptions.agentId) throw new Error('Workflow execution requires a configured Agent');
  const profile = config && childOptions.agentId ? resolveEffectiveAgentProfile(childOptions.agentId) : undefined;
  const childFactory = new AgentToolsFactory({
    workspace: childOptions.workspace,
    bus: childOptions.bus,
    getCurrentContext: () => ({
      conversationId: childOptions.conversationId, channel: 'workflow', chatId: childOptions.conversationId,
      origin: { type: 'system', source: 'workflow' },
    }),
    getConfig: childOptions.getConfig,
    getPrimaryModel: () => childOptions.model,
    endpointTools: childOptions.endpointTools,
    toolExecutorConfig: { ...childOptions.toolExecutorConfig,
      resolveTimeoutMs: name => childOptions.getConfig() && childOptions.agentId
        ? resolveEffectiveAgentProfile(childOptions.agentId).config.tools[name]?.timeoutMs : undefined },
  });
  return childFactory.createAllTools({
    workspace: childOptions.workspace,
    getPrimaryModel: () => childOptions.model,
    agentId: childOptions.agentId,
    conversationId: childOptions.conversationId,
    disabledTools: profile?.tools.denied,
    toolAllowlist: profile?.config.toolAllowlist,
  });
}
