import type { AgentTool } from '@earendil-works/pi-agent-core';

import type { BuildChildToolsOptions } from '../child-agent-factory.js';
import { AgentToolsFactory } from '../tools/factory.js';
import { resolveEffectiveAgentProfileForSession, resolveEffectiveAgentProfile } from '../../config/agent-profile.js';

/** Builds the tool set for workflow child agents (wired from gateway to avoid cycles). */
export function buildWorkflowChildTools(childOptions: BuildChildToolsOptions): AgentTool<any, any>[] {
  const config = childOptions.getConfig();
  const profile = config ? childOptions.browserConversationId
    ? resolveEffectiveAgentProfileForSession(config, childOptions.browserConversationId)
    : childOptions.agentId ? resolveEffectiveAgentProfile(config, childOptions.agentId) : resolveEffectiveAgentProfileForSession(config, undefined) : undefined;
  const childFactory = new AgentToolsFactory({
    workspace: childOptions.workspace,
    bus: childOptions.bus,
    getCurrentContext: () => childOptions.browserConversationId ? {
      conversationId: childOptions.browserConversationId, channel: 'workflow', chatId: childOptions.browserConversationId,
      origin: { type: 'system', source: 'workflow' },
    } : null,
    getConfig: childOptions.getConfig,
    getPrimaryModel: () => childOptions.model,
    endpointTools: childOptions.endpointTools,
    toolExecutorConfig: childOptions.toolExecutorConfig,
  });
  return childFactory.createAllTools({
    workspace: childOptions.workspace,
    getPrimaryModel: () => childOptions.model,
    agentId: childOptions.agentId,
    conversationId: childOptions.browserConversationId,
    disabledTools: profile?.tools.denied,
  });
}
