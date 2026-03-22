import type { ChannelCommandAdapter, ChannelCommandSpec } from '@xopcai/xopcbot/channels/plugin-types.js';

/**
 * Declarative list of BotFather-style commands handled in `command-handler.ts` / `plugin.ts` message routing.
 */
export function createTelegramCommandAdapter(): ChannelCommandAdapter {
  return {
    listCommands(): ChannelCommandSpec[] {
      return [
        { name: '/start', description: 'Start or show main menu', acceptsArgs: false },
        { name: '/models', description: 'Choose LLM model', acceptsArgs: false },
        { name: '/cleanup', description: 'Reset session context', acceptsArgs: false },
      ];
    },
  };
}
