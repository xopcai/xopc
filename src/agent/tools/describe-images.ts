import { complete, type Api, type Context, type Model } from '@mariozechner/pi-ai';
import { resolveModel, getApiKey } from '../../providers/index.js';
import { coerceImageAssistantText } from './image-tool.helpers.js';

function resolveImageToolMaxTokens(modelMaxTokens: number | undefined, requestedMaxTokens = 4096) {
  if (
    typeof modelMaxTokens !== 'number' ||
    !Number.isFinite(modelMaxTokens) ||
    modelMaxTokens <= 0
  ) {
    return requestedMaxTokens;
  }
  return Math.min(requestedMaxTokens, modelMaxTokens);
}

export async function describeImagesWithPiAi(params: {
  modelRef: string;
  prompt: string;
  images: Array<{ buffer: Buffer; mimeType: string }>;
  maxTokens?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<{ text: string; provider: string; model: string }> {
  const model = resolveModel(params.modelRef) as Model<Api>;
  if (!model.input?.includes('image')) {
    throw new Error(`Model does not support images: ${params.modelRef}`);
  }
  const apiKey = await getApiKey(model.provider);
  if (!apiKey) {
    throw new Error(`No API key configured for provider: ${model.provider}`);
  }

  const context: Context = {
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: params.prompt },
          ...params.images.map((img) => ({
            type: 'image' as const,
            data: img.buffer.toString('base64'),
            mimeType: img.mimeType || 'image/jpeg',
          })),
        ],
        timestamp: Date.now(),
      },
    ],
  };

  const maxTokens = resolveImageToolMaxTokens(
    model.maxTokens,
    params.maxTokens ?? 512,
  );

  const timeoutMs = params.timeoutMs ?? 60_000;
  const timeoutSignal =
    typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
      ? AbortSignal.timeout(timeoutMs)
      : undefined;
  const signal = (() => {
    if (timeoutSignal && params.signal && typeof AbortSignal.any === 'function') {
      return AbortSignal.any([params.signal, timeoutSignal]);
    }
    if (params.signal) {
      return params.signal;
    }
    if (timeoutSignal) {
      return timeoutSignal;
    }
    const c = new AbortController();
    setTimeout(() => c.abort(), timeoutMs);
    return c.signal;
  })();

  const message = await complete(model, context, {
    apiKey,
    maxTokens,
    signal,
  });

  const text = coerceImageAssistantText({
    message,
    provider: model.provider,
    model: model.id,
  });
  return { text, provider: model.provider, model: model.id };
}
