import { assertProviderUsage, withModelUsageOrigin, modelUsageOriginForCall } from './model-usage.js';
import {
  completeSimple,
  normalizeContext,
  type Api,
  type AssistantMessage,
  type Context,
  type Model,
  type SimpleStreamOptions,
} from '@earendil-works/pi-ai/compat';

import type { CredentialResolverOptions } from '../auth/credentials.js';
import { EXTENSION_PROVIDER_BASE_URL } from './constants.js';
import { createExtensionAwareStreamFn } from './extension-stream-bridge.js';
import { getApiKey } from './index.js';
import { finishAiUsageFromMessage, observeAiUsageStream, startAiUsageCall } from '../usage/recorder.js';
import type { AiUsageContext } from '../usage/types.js';
import { withCloudUsageResponse } from '../usage/cloud-receipts.js';
import { assertCloudCreditBudgetActive, cloudCreditBudgetHeaders, reportCloudCreditError } from './xopc-cloud-credit-budget.js';

export function isLocalModelBaseUrl(baseUrl: string | undefined): boolean {
  if (!baseUrl) return false;
  try {
    const url = new URL(baseUrl);
    const host = url.hostname.toLowerCase();
    return (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1' ||
      host === '[::1]' ||
      host.startsWith('127.') ||
      host.startsWith('10.') ||
      host.startsWith('192.168.') ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
    );
  } catch {
    return false;
  }
}

export async function resolveModelCallApiKey(
  model: Model<Api>,
  credentialOptions?: CredentialResolverOptions,
): Promise<string | undefined> {
  try {
    const apiKey = credentialOptions
      ? await getApiKey(model.provider, credentialOptions)
      : await getApiKey(model.provider);
    if (apiKey) return apiKey;
  } catch {
    if (!isLocalModelBaseUrl(model.baseUrl)) throw new Error(`Could not load credentials for provider: ${model.provider}`);
  }

  return isLocalModelBaseUrl(model.baseUrl) ? 'xopc-local' : undefined;
}

export async function resolveModelCallOptions(
  model: Model<Api>,
  options: SimpleStreamOptions = {},
  credentialOptions?: CredentialResolverOptions,
): Promise<SimpleStreamOptions> {
  assertCloudCreditBudgetActive();
  assertProviderUsage(model.provider, model.baseUrl);
  if (model.provider === 'xopc-cloud') options = withCloudUsageResponse(options);
  const apiKey = options.apiKey ?? await resolveModelCallApiKey(model, credentialOptions);
  if (!apiKey) {
    throw new Error(`No API key for provider: ${model.provider}`);
  }

  const { temperature, ...rest } = options;
  return {
    ...rest,
    apiKey,
    ...(model.provider === 'xopc-cloud' ? { headers: { ...options.headers, ...await cloudCreditBudgetHeaders() } } : {}),
    ...(temperature !== undefined ? { temperature } : {}),
  };
}

/**
 * Complete a one-shot request with xopc credential resolution and extension-provider routing.
 */
async function completeWithResolvedCredentialsInner(
  model: Model<Api>,
  context: Context,
  options: SimpleStreamOptions,
  credentialOptions: CredentialResolverOptions | undefined,
  usageContext: AiUsageContext,
): Promise<AssistantMessage> {
  if (usageContext.trigger === 'scheduled' || usageContext.trigger === 'system') {
    withModelUsageOrigin('background', () => assertProviderUsage(model.provider, model.baseUrl));
  }
  const resolvedOptions = await resolveModelCallOptions(model, options, credentialOptions);
  const usageCall = startAiUsageCall(model, usageContext, { context, options: { reasoning: options.reasoning, temperature: options.temperature, maxTokens: options.maxTokens } });
  try {
    if (model.baseUrl === EXTENSION_PROVIDER_BASE_URL) {
      const stream = await usageCall.run(() => createExtensionAwareStreamFn()(model, normalizeContext(context), resolvedOptions));
      const result = await stream.result();
      finishAiUsageFromMessage(usageCall, result);
      return result;
    }
    const result = await usageCall.run(() => completeSimple(model, context, resolvedOptions));
    if (result.errorMessage) reportCloudCreditError(result.errorMessage);
    finishAiUsageFromMessage(usageCall, result);
    return result;
  } catch (error) {
    reportCloudCreditError(error instanceof Error ? error.message : String(error));
    usageCall?.finish({ status: 'failed', errorSummary: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

/**
 * Start a model stream with xopc credential resolution and extension-provider routing.
 * Callers that need live visible output should consume the returned stream before calling
 * its `result()` method.
 */
async function createResolvedModelStreamInner(
  model: Model<Api>,
  context: Context,
  options: SimpleStreamOptions,
  credentialOptions: CredentialResolverOptions | undefined,
  usageContext: AiUsageContext,
) {
  if (usageContext.trigger === 'scheduled' || usageContext.trigger === 'system') {
    withModelUsageOrigin('background', () => assertProviderUsage(model.provider, model.baseUrl));
  }
  const resolvedOptions = await resolveModelCallOptions(model, options, credentialOptions);
  const usageCall = startAiUsageCall(model, usageContext, { context, options: { reasoning: options.reasoning, temperature: options.temperature, maxTokens: options.maxTokens } });
  try {
    const stream = await usageCall.run(() => createExtensionAwareStreamFn()(model, normalizeContext(context), resolvedOptions));
    void stream.result().then(message => {
      if (message.errorMessage) reportCloudCreditError(message.errorMessage);
    }).catch(() => {});
    return observeAiUsageStream(stream, usageCall);
  } catch (error) {
    usageCall?.finish({ status: 'failed', errorSummary: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

export function completeWithResolvedCredentials(...args: Parameters<typeof completeWithResolvedCredentialsInner>) {
  return withModelUsageOrigin(modelUsageOriginForCall(args[4]), () => completeWithResolvedCredentialsInner(...args));
}
export function createResolvedModelStream(...args: Parameters<typeof createResolvedModelStreamInner>) {
  return withModelUsageOrigin(modelUsageOriginForCall(args[4]), () => createResolvedModelStreamInner(...args));
}
