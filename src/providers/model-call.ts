import {
  complete,
  type Api,
  type AssistantMessage,
  type Context,
  type Model,
  type SimpleStreamOptions,
} from '@earendil-works/pi-ai/compat';

import type { CredentialResolverOptions } from '../auth/credentials.js';
import { EXTENSION_PROVIDER_BASE_URL } from './constants.js';
import { getApiKey } from './index.js';
import { createExtensionAwareStreamFn } from './extension-stream-bridge.js';

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

/** Codex Responses rejects the temperature request parameter. */
export function supportsModelTemperature(model: Model<Api>): boolean {
  return model.api !== 'openai-codex-responses';
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
  const apiKey = options.apiKey ?? await resolveModelCallApiKey(model, credentialOptions);
  if (!apiKey) {
    throw new Error(`No API key for provider: ${model.provider}`);
  }

  const { temperature, ...rest } = options;
  return {
    ...rest,
    apiKey,
    ...(temperature !== undefined && supportsModelTemperature(model) ? { temperature } : {}),
  };
}

/**
 * Complete a one-shot request with xopc credential resolution and extension-provider routing.
 */
export async function completeWithResolvedCredentials(
  model: Model<Api>,
  context: Context,
  options: SimpleStreamOptions = {},
  credentialOptions?: CredentialResolverOptions,
): Promise<AssistantMessage> {
  const resolvedOptions = await resolveModelCallOptions(model, options, credentialOptions);
  if (model.baseUrl === EXTENSION_PROVIDER_BASE_URL) {
    const stream = await createExtensionAwareStreamFn()(model, context, resolvedOptions);
    return await stream.result();
  }
  return await complete(model, context, resolvedOptions as never);
}

/**
 * Start a model stream with xopc credential resolution and extension-provider routing.
 * Callers that need live visible output should consume the returned stream before calling
 * its `result()` method.
 */
export async function createResolvedModelStream(
  model: Model<Api>,
  context: Context,
  options: SimpleStreamOptions = {},
  credentialOptions?: CredentialResolverOptions,
) {
  const resolvedOptions = await resolveModelCallOptions(model, options, credentialOptions);
  return await createExtensionAwareStreamFn()(model, context, resolvedOptions);
}
