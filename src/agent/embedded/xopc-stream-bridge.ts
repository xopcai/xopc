import type { Model, Api, Context, SimpleStreamOptions } from '@earendil-works/pi-ai';
import type { StreamFn } from '@earendil-works/pi-agent-core';

import { EXTENSION_PROVIDER_BASE_URL } from '../../providers/index.js';
import { createExtensionAwareStreamFn } from '../../providers/extension-stream-bridge.js';

/**
 * pi-coding-agent's default {@link createAgentSession} streamFn always routes through
 * pi-ai's HTTP `streamSimple`, so xopc plugin providers (whose models carry the sentinel
 * `EXTENSION_PROVIDER_BASE_URL`) never reach their {@link ProviderPluginRegistry}
 * implementation. Wrap the original streamFn so plugin models go through xopc's bridge
 * and everything else falls through to the original auth-aware streamFn.
 *
 * Use this by reassigning {@link Agent.streamFunction} after `createAgentSession` returns.
 */
export function wrapStreamFnForXopcExtensions(originalStreamFn: StreamFn): StreamFn {
  const extensionStreamFn = createExtensionAwareStreamFn();

  return ((model: Model<Api>, context: Context, options?: SimpleStreamOptions) => {
    if (model.baseUrl === EXTENSION_PROVIDER_BASE_URL) {
      return extensionStreamFn(model, context, options);
    }
    return originalStreamFn(model, context, options);
  }) as StreamFn;
}
