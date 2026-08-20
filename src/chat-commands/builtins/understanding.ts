import { resolveDefaultAgentId } from '../../agent/agent-scope.js';
import { createManualUnderstanding } from '../../user-context/manual-understanding.js';
import { commandRegistry } from '../registry.js';
import type { CommandContext, CommandDefinition } from '../types.js';

function parseRememberArgs(args: string): { content: string; sessionOnly: boolean } {
  const trimmed = args.trim();
  if (trimmed !== '--session' && !trimmed.startsWith('--session ')) {
    return { content: trimmed, sessionOnly: false };
  }
  return { content: trimmed.slice('--session'.length).trim(), sessionOnly: true };
}

const rememberCommand: CommandDefinition = {
  id: 'understanding.remember',
  name: 'remember',
  description: 'Explicitly tell xopc something to remember (--session keeps it in this conversation)',
  category: 'session',
  scope: ['private'],
  acceptsArgs: true,
  examples: ['/remember I prefer concise updates', '/remember --session This chat is about launch planning'],
  handler: async (ctx: CommandContext, args: string) => {
    const { content, sessionOnly } = parseRememberArgs(args);
    if (!content || content.length > 5_000) {
      return { content: 'Usage: /remember [--session] <what xopc should know> (max 5000 characters)', success: false };
    }
    const result = createManualUnderstanding({
      agentId: resolveDefaultAgentId(ctx.config),
      content,
      kind: 'derived_insight',
      scope: sessionOnly ? { type: 'session', sessionKey: ctx.sessionKey } : { type: 'global' },
      sensitivity: 'normal',
      durability: sessionOnly ? 'ephemeral' : 'durable',
      disclosurePolicy: 'referenceable',
    });
    const scopeLabel = sessionOnly ? 'this conversation' : 'all conversations';
    return {
      content: result.created
        ? `Remembered for ${scopeLabel}. You can review or remove it in About You.`
        : `This is already remembered for ${scopeLabel}.`,
      success: true,
    };
  },
};

const learningCommand: CommandDefinition = {
  id: 'understanding.learning',
  name: 'learning',
  aliases: ['learn'],
  description: 'Control user-understanding context and learning for this conversation (on | off | status)',
  category: 'session',
  scope: ['private'],
  acceptsArgs: true,
  examples: ['/learning off', '/learning on', '/learning status'],
  handler: async (ctx: CommandContext, args: string) => {
    const store = ctx.getSessionConfigStore?.();
    if (!store) return { content: 'Session settings are unavailable here.', success: false };
    const action = args.trim().toLowerCase() || 'status';
    if (!['on', 'off', 'status'].includes(action)) {
      return { content: 'Usage: /learning on | off | status', success: false };
    }
    if (action !== 'status') {
      await store.update(ctx.sessionKey, { userContextMode: action === 'off' ? 'off' : 'enabled' });
    }
    const globallyEnabled = ctx.config.userContext.enabled && ctx.config.userContext.memory.mode !== 'off';
    const enabled = globallyEnabled && (await store.get(ctx.sessionKey))?.userContextMode !== 'off';
    return {
      content: enabled
        ? 'User understanding is enabled for this conversation.'
        : globallyEnabled
          ? 'User understanding is off for this conversation. Existing chat history is still stored; use /remember for anything you explicitly want saved.'
          : 'User understanding is disabled globally. Existing chat history is still stored.',
      success: true,
    };
  },
};

export function registerUnderstandingCommands(): void {
  commandRegistry.register(rememberCommand);
  commandRegistry.register(learningCommand);
}
