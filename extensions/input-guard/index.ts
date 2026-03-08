/**
 * Input Guard Plugin - Phase 1 Input Hook Example
 *
 * Demonstrates: Input hook for content moderation and quick commands
 *
 * Usage: xopcbot plugin install ./examples/plugins/input-guard
 */

import type { PluginApi } from 'xopcbot/plugin-sdk';

export default function(api: PluginApi) {
  const config = api.pluginConfig;
  const blockedWords = (config.blockedWords as string[]) || ['spam', 'scam'];

  api.logger.info('Input Guard plugin registered!');

  // Input Hook: Intercept and process user input
  api.registerHook('input', async (event) => {
    const text = (event as any).text?.toLowerCase() || '';

    // 1. Content Moderation: Block forbidden words
    for (const word of blockedWords) {
      if (text.includes(word.toLowerCase())) {
        api.logger.warn(`Blocked message containing: "${word}"`);
        return {
          action: 'handled',
          response: `🚫 Message blocked due to inappropriate content.`,
        };
      }
    }

    // 2. Quick Commands: Handle without LLM
    if (text === '!ping') {
      return { action: 'handled', response: '🏓 Pong!' };
    }

    if (text === '!time') {
      return { action: 'handled', response: `🕐 Current time: ${new Date().toLocaleTimeString()}` };
    }

    if (text === '!help') {
      return {
        action: 'handled',
        response: 'Available commands: !ping, !time, !help',
      };
    }

    // Continue to LLM for normal messages
    return { action: 'continue' };
  });
}
