import type { Config } from '../../config/schema.js';
import { resolveEffectiveAgentConfigForAgent, resolveEffectiveAgentConfigForSession } from '../../config/agent-profile.js';
import { createAgentTurnPolicy } from '../orchestration/agent-turn-policy.js';

/** Noninteractive callers cannot silently turn an ask policy into an allow. */
export function createDelegationParentPolicy(options: { getConfig: () => Config | undefined; conversationId?: string; agentId?: string }) {
  const policies = (name: string, args: unknown) => {
    const config = options.getConfig();
    if (!config) return [];
    const resolved = options.conversationId ? resolveEffectiveAgentConfigForSession(options.conversationId)
      : options.agentId ? resolveEffectiveAgentConfigForAgent(options.agentId) : resolveEffectiveAgentConfigForSession(undefined);
    const names = [name];
    const command = (args as { command?: unknown })?.command;
    if ((name === 'user_context_read' || name === 'knowledge_read') && (command === 'search' || command === 'get')) {
      names.push(`${name.slice(0, -5)}_${command}`);
    }
    if (name === 'xopc_tool_execute') {
      const ref = String((args as { toolRef?: unknown })?.toolRef ?? '');
      names.push(ref);
    }
    return names.flatMap(id => resolved.config.tools[id] ? [{ id, ...resolved.config.tools[id] }] : []);
  };
  return createAgentTurnPolicy({
    authorizeToolCall: async context => {
      const blocked = policies(context.toolCall.name, context.args).find(policy => policy.mode !== 'allow');
      return blocked ? { block: true, reason: `${blocked.id} requires parent authorization (${blocked.mode}).` } : undefined;
    },
    resolveToolLimit: (name, args) => {
      const limited = policies(name, args).filter(policy => policy.maxCallsPerTurn).sort((a, b) => a.maxCallsPerTurn! - b.maxCallsPerTurn!)[0];
      return limited ? { id: limited.id, maxCalls: limited.maxCallsPerTurn! } : undefined;
    },
  });
}
