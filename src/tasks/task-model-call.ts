import type { Context, SimpleStreamOptions } from '@earendil-works/pi-ai/compat';

import { resolveModel } from '../providers/index.js';
import { completeWithResolvedCredentials } from '../providers/model-call.js';
import { getAssistantMessageErrorReason, isTransientProviderErrorMessage } from '../providers/model-response.js';
import type { AiUsageContext } from '../usage/types.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('TaskModelCall');

/** Background calls use only the configured model chain, under the caller's original deadline. */
export async function completeTaskModelCall(models: { primary: string; fallbacks?: string[] }, context: Context,
  options: SimpleStreamOptions, usage: AiUsageContext) {
  const chain = [...new Set([models.primary, ...(models.fallbacks ?? [])])].slice(0, 3);
  if (chain.length === 1) chain.push(chain[0]);
  for (let index = 0; index < chain.length; index++) {
    options.signal?.throwIfAborted();
    try {
      const response = await completeWithResolvedCredentials(resolveModel(chain[index]), context, options, undefined, usage);
      const error = getAssistantMessageErrorReason(response);
      if (error) throw new Error(error);
      return response;
    } catch (error) {
      options.signal?.throwIfAborted();
      const message = error instanceof Error ? error.message : String(error);
      const missingCredential = /^No API key for provider:/i.test(message) && chain[index + 1] !== chain[index];
      if (index === chain.length - 1 || (!missingCredential && !isTransientProviderErrorMessage(message))) throw error;
      log.warn({ modelRef: chain[index], nextModelRef: chain[index + 1], operation: usage.operation,
        conversationId: usage.conversationId }, missingCredential
        ? 'Task model credentials are missing; trying configured fallback model'
        : 'Task model request failed transiently; trying configured recovery model');
    }
  }
  throw new Error('No task model is configured');
}
