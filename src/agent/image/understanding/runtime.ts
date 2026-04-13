import { parseModelRef } from '../../../config/schema.js';
import { getImageUnderstandingProvider } from './provider-registry.js';
import type { ImageUnderstandingRequest, ImageUnderstandingResult } from './types.js';

import './pi-ai-provider.js';

export type DescribeImagesParams = ImageUnderstandingRequest & {
  modelRef: string;
};

export type DescribeImagesWithFallbackParams = ImageUnderstandingRequest & {
  modelRef: string;
  fallbacks?: string[];
};

export type DescribeImagesAttempt = {
  provider: string;
  model: string;
  error: string;
};

export type DescribeImagesWithFallbackResult = ImageUnderstandingResult & {
  attempts: DescribeImagesAttempt[];
};

export async function describeImages(
  params: DescribeImagesParams,
): Promise<ImageUnderstandingResult> {
  const parsed = parseModelRef(params.modelRef);
  if (!parsed) {
    throw new Error(`Invalid model reference: ${params.modelRef}`);
  }

  const provider = getImageUnderstandingProvider(parsed.provider);
  if (!provider) {
    throw new Error(
      `No image understanding provider registered for: ${parsed.provider}. Ensure the provider module is imported.`,
    );
  }

  return provider.describeImages(parsed.model, {
    images: params.images,
    prompt: params.prompt,
    maxTokens: params.maxTokens,
    timeoutMs: params.timeoutMs,
    signal: params.signal,
  });
}

export async function describeImagesWithFallback(
  params: DescribeImagesWithFallbackParams,
): Promise<DescribeImagesWithFallbackResult> {
  const modelRefs = [params.modelRef, ...(params.fallbacks ?? [])];
  const attempts: DescribeImagesAttempt[] = [];
  let lastError: unknown;

  for (const modelRef of modelRefs) {
    const parsed = parseModelRef(modelRef);
    if (!parsed) {
      attempts.push({
        provider: modelRef,
        model: '',
        error: `Invalid model reference: ${modelRef}`,
      });
      continue;
    }

    const provider = getImageUnderstandingProvider(parsed.provider);
    if (!provider) {
      attempts.push({
        provider: parsed.provider,
        model: parsed.model,
        error: `No provider registered for: ${parsed.provider}`,
      });
      continue;
    }

    try {
      const result = await provider.describeImages(parsed.model, {
        images: params.images,
        prompt: params.prompt,
        maxTokens: params.maxTokens,
        timeoutMs: params.timeoutMs,
        signal: params.signal,
      });
      return { ...result, attempts };
    } catch (err) {
      lastError = err;
      attempts.push({
        provider: parsed.provider,
        model: parsed.model,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const summary = attempts.map((a) => `${a.provider}/${a.model}: ${a.error}`).join(' | ');
  throw new Error(`All image understanding models failed (${attempts.length}): ${summary}`, {
    cause: lastError instanceof Error ? lastError : undefined,
  });
}
