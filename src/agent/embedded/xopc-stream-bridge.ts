import {
  getCurrentSystemPrompt,
  getCurrentTools,
  normalizeContext,
  type Model,
  type Api,
  type SimpleStreamOptions,
  type TranscriptContext,
} from '@earendil-works/pi-ai';
import type { StreamFn } from '@earendil-works/pi-agent-core';

import { EXTENSION_PROVIDER_BASE_URL } from '../../providers/index.js';
import { createExtensionAwareStreamFn } from '../../providers/extension-stream-bridge.js';
import {
  preparePromptCacheContext,
  withPromptCachePayloadTransform,
} from '../../providers/prompt-cache-payload.js';
import type { PromptCachePolicy } from '../../providers/prompt-cache-plan.js';
import { withCloudUsageResponse } from '../../usage/cloud-receipts.js';
import { assertCloudCreditBudgetActive, cloudCreditBudgetHeaders, hasCloudCreditBudget, reportCloudCreditError } from '../../providers/xopc-cloud-credit-budget.js';

/**
 * pi-coding-agent's default {@link createAgentSession} streamFn always routes through
 * pi-ai's HTTP `streamSimple`, so xopc plugin providers (whose models carry the sentinel
 * `EXTENSION_PROVIDER_BASE_URL`) never reach their {@link ProviderPluginRegistry}
 * implementation. Wrap the original streamFn so plugin models go through xopc's bridge
 * and everything else falls through to the original auth-aware streamFn.
 *
 * Use this by reassigning {@link Agent.streamFunction} after `createAgentSession` returns.
 */
export function wrapStreamFnForXopcExtensions(
  originalStreamFn: StreamFn,
  promptCachePolicy?: PromptCachePolicy,
): StreamFn {
  const extensionStreamFn = createExtensionAwareStreamFn();

  return ((model: Model<Api>, context: TranscriptContext, options?: SimpleStreamOptions) => {
    assertCloudCreditBudgetActive();
    if (model.provider === 'xopc-cloud') options = withCloudUsageResponse(options);
    const promptContext = {
      systemPrompt: getCurrentSystemPrompt(context.messages),
      tools: getCurrentTools(context.messages),
    };
    const preparedContext = preparePromptCacheContext(model, promptContext);
    const providerContext = preparedContext.systemPrompt === promptContext.systemPrompt
      ? context
      : normalizeContext({
          systemPrompt: preparedContext.systemPrompt,
          tools: promptContext.tools,
          messages: context.messages.filter(message => message.role !== 'system'),
        });
    if (model.baseUrl === EXTENSION_PROVIDER_BASE_URL) {
      return extensionStreamFn(model, providerContext, options);
    }
    if (model.provider === 'xopc-cloud' && hasCloudCreditBudget()) {
      return (async () => {
        const headers = await cloudCreditBudgetHeaders();
        const stream = await originalStreamFn(model, providerContext,
          withPromptCachePayloadTransform(model, promptContext,
            { ...options, headers: { ...options?.headers, ...headers } }, promptCachePolicy));
        void stream.result().then(message => {
          if (message.errorMessage) reportCloudCreditError(message.errorMessage);
        }).catch(() => {});
        return stream;
      })();
    }
    return originalStreamFn(
      model,
      providerContext,
      withPromptCachePayloadTransform(model, promptContext, options, promptCachePolicy),
    );
  }) as StreamFn;
}
