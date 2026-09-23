import type { Config } from '../../config/schema.js';
import { resolveEffectiveAgentConfigForAgent, resolveEffectiveAgentConfigForSession } from '../../config/agent-profile.js';
import { parseExternalToolRef } from '../external-tools/refs.js';
import { mcpToolPolicyId } from '../mcp/bundle-mcp-policy.js';
import { createAgentTurnPolicy } from '../orchestration/agent-turn-policy.js';

/** Noninteractive callers cannot silently turn an ask policy into an allow. */
export function createDelegationParentPolicy(options: { getConfig: () => Config | undefined; conversationId?: string; agentId?: string }) {
  const policies = (name: string, args: unknown) => {
    const config = options.getConfig();
    if (!config) return [];
    const resolved = options.conversationId ? resolveEffectiveAgentConfigForSession(options.conversationId)
      : options.agentId ? resolveEffectiveAgentConfigForAgent(options.agentId) : resolveEffectiveAgentConfigForSession(undefined);
    const names = [name];
    if (name === 'xopc_tool_execute') {
      const parsed = parseExternalToolRef(String((args as { toolRef?: unknown })?.toolRef ?? ''), 'mcp');
      const ref = String((args as { toolRef?: unknown })?.toolRef ?? '');
      names.push(parsed ? mcpToolPolicyId(parsed.namespace, parsed.toolName) : ref);
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
