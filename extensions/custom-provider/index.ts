/**
 * Custom Provider Extension — provider registration example
 *
 * Demonstrates the current provider registration contract.
 *
 * Usage: xopc extension install ./examples/extensions/custom-provider
 */

import type { ExtensionApi } from '@xopcai/xopc/extension-sdk';

export default function(api: ExtensionApi) {
  api.logger.info('Custom Provider extension registered!');

  api.registerProvider({
    id: 'my-proxy',
    name: 'My Proxy',
    models: [{
      id: 'gpt-4-custom',
      name: 'GPT-4 (Custom)',
      contextWindow: 128000,
      maxOutputTokens: 8192,
    }],
    async *createStream() {
      yield { type: 'error', error: 'Configure a real provider transport before use.' };
    },
  });

  api.logger.info('Provider "my-proxy" registered with custom model');
}
