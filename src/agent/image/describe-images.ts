import { describeImages } from './understanding/runtime.js';

/**
 * @deprecated Prefer `describeImages` from `./understanding/runtime.js`.
 */
export async function describeImagesWithPiAi(params: {
  modelRef: string;
  prompt: string;
  images: Array<{ buffer: Buffer; mimeType: string }>;
  maxTokens?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<{ text: string; provider: string; model: string }> {
  return describeImages({
    modelRef: params.modelRef,
    prompt: params.prompt,
    images: params.images,
    maxTokens: params.maxTokens,
    timeoutMs: params.timeoutMs,
    signal: params.signal,
  });
}
