/**
 * /context — inspect approximate prompt/context budget (config + transcript stats).
 */

import type { CommandDefinition, CommandContext } from '../types.js';
import { commandRegistry } from '../registry.js';

function parseMode(args: string): 'list' | 'detail' | 'json' {
  const w = args.trim().split(/\s+/)[0]?.toLowerCase();
  if (w === 'detail' || w === 'json' || w === 'list') return w;
  return 'list';
}

const contextCommand: CommandDefinition = {
  id: 'session.context',
  name: 'context',
  description: 'Show context budget and config snapshot (list | detail | json)',
  category: 'session',
  scope: ['global', 'private', 'group'],
  acceptsArgs: true,
  examples: ['/context', '/context detail', '/context json'],
  handler: async (ctx: CommandContext, args: string) => {
    await ctx.setTyping(true);
    const mode = parseMode(args);
    const text = await ctx.agentContextReport?.(mode);
    if (text === undefined) {
      return { content: '⚠️ Context report is not available here.', success: false };
    }
    return { content: text, success: true };
  },
};

export function registerContextCommands(): void {
  commandRegistry.register(contextCommand);
}
