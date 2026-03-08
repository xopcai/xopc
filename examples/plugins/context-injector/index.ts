/**
 * Context Injector Plugin - Phase 1 Context Hook Example
 *
 * Demonstrates: Context hook to inject system messages before LLM
 *
 * Usage: xopcbot plugin install ./examples/plugins/context-injector
 */

import type { PluginApi } from 'xopcbot/plugin-sdk';

export default function(api: PluginApi) {
  const config = api.pluginConfig;
  const injectedContext = (config.injectedContext as string) || 'Remember to be concise.';

  api.logger.info('Context Injector plugin registered!');

  // Context Hook: Inject system messages before sending to LLM
  api.registerHook('context', async (event) => {
    const messages = [...(event as any).messages];

    // Find last system message position
    let lastSystemIndex = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'system') {
        lastSystemIndex = i;
        break;
      }
    }

    // Inject context after last system message
    if (lastSystemIndex >= 0) {
      messages.splice(lastSystemIndex + 1, 0, {
        role: 'system',
        content: `[Plugin Context] ${injectedContext}`,
      });
    } else {
      messages.unshift({
        role: 'system',
        content: `[Plugin Context] ${injectedContext}`,
      });
    }

    api.logger.debug(`Injected context into ${messages.length} messages`);
    return { messages };
  });

  // Turn lifecycle tracking
  api.registerHook('turn_start', () => {
    api.logger.debug('New conversation turn started');
  });

  api.registerHook('turn_end', () => {
    api.logger.debug('Conversation turn ended');
  });
}
