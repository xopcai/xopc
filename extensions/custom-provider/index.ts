/**
 * Custom Provider Extension - Phase 4 Example
 *
 * Demonstrates: Provider registration, CLI flags, and shortcuts
 *
 * Usage: xopcbot extension install ./examples/extensions/custom-provider
 */

import type { ExtensionApi } from 'xopcbot/extension-sdk';

export default function(api: ExtensionApi) {
  api.logger.info('Custom Provider extension registered!');

  // Register CLI Flag
  api.registerFlag('custom-model', {
    type: 'string',
    default: 'gpt-4',
    description: 'Select custom model',
    aliases: ['-m', '--model'],
  });

  // Read flag value
  const selectedModel = api.getFlag('custom-model');
  api.logger.info(`Selected model: ${selectedModel}`);

  // Register Keyboard Shortcut
  api.registerShortcut('ctrl+shift+m', {
    description: 'Switch to custom model',
    handler: async () => {
      api.logger.info('Switching to custom model...');
    },
  });

  // Register Custom Provider
  api.registerProvider('my-proxy', {
    name: 'My Proxy',
    baseUrl: 'https://proxy.example.com/v1',
    apiKey: 'sk-xxx',
    api: 'openai-completions',
    models: [{
      id: 'gpt-4-custom',
      name: 'GPT-4 (Custom)',
      contextWindow: 128000,
      maxTokens: 8192,
    }],
  });

  api.logger.info('Provider "my-proxy" registered with custom model');
}
