import { createHash } from 'node:crypto';

import { reconcileAssertion } from '../../user-model/index.js';
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
    const mode = (await ctx.getSessionConfigStore?.().get(ctx.sessionKey))?.userContextMode;
    if (mode === 'temporary') {
      return { content: 'This conversation is temporary, so it cannot save user understanding.', success: false };
    }
    const { content, sessionOnly } = parseRememberArgs(args);
    if (!content || content.length > 5_000) {
      return { content: 'Usage: /remember [--session] <what xopc should know> (max 5000 characters)', success: false };
    }
    const result = reconcileAssertion({
      subject: { type: 'user', id: 'self' },
      predicate: `remembered.${createHash('sha256').update(content.toLocaleLowerCase()).digest('hex').slice(0, 20)}`,
      cardinality: 'single',
      value: content,
      normalizedValue: content.toLocaleLowerCase(),
      statement: content,
      kind: 'derived_insight',
      scope: sessionOnly ? { type: 'session', id: ctx.sessionKey } : { type: 'global' },
      authority: 'user_explicit',
      confidence: 1,
      declaredImportance: 0.8,
      inferredImportance: 0.8,
      consequence: 'medium',
      actionability: 0.7,
      volatility: sessionOnly ? 'dynamic' : 'stable',
      sensitivity: 'normal',
      disclosurePolicy: 'referenceable',
      observedAt: Date.now(),
      createdBy: 'user',
    });
    const scopeLabel = sessionOnly ? 'this conversation' : 'all conversations';
    return {
      content: result.action === 'created'
        ? `Remembered for ${scopeLabel}. You can review or remove it in User Model.`
        : `This is already remembered for ${scopeLabel}.`,
      success: true,
    };
  },
};

const learningCommand: CommandDefinition = {
  id: 'understanding.learning',
  name: 'learning',
  aliases: ['learn'],
  description: 'Control user-understanding context and learning for this conversation (on | off | temporary | status)',
  category: 'session',
  scope: ['private'],
  acceptsArgs: true,
  examples: ['/learning temporary', '/learning off', '/learning on', '/learning status'],
  handler: async (ctx: CommandContext, args: string) => {
    const store = ctx.getSessionConfigStore?.();
    if (!store) return { content: 'Session settings are unavailable here.', success: false };
    const action = args.trim().toLowerCase() || 'status';
    if (!['on', 'off', 'temporary', 'status'].includes(action)) {
      return { content: 'Usage: /learning on | off | temporary | status', success: false };
    }
    if (action !== 'status') {
      await store.update(ctx.sessionKey, {
        userContextMode: action === 'on' ? 'enabled' : action as 'off' | 'temporary',
      });
    }
    const globallyEnabled = ctx.config.userContext.enabled;
    const mode = (await store.get(ctx.sessionKey))?.userContextMode ?? 'enabled';
    const enabled = globallyEnabled && mode === 'enabled';
    return {
      content: enabled
        ? 'User understanding is enabled for this conversation.'
        : globallyEnabled && mode === 'temporary'
          ? 'This is a temporary conversation. Stored user context is not read, and this conversation does not update user understanding.'
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
