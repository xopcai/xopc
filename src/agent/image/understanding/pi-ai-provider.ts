import { complete, type Api, type Context, type Model } from '@mariozechner/pi-ai';
import { resolveModel, getApiKey } from '../../../providers/index.js';
import { coerceImageAssistantText } from '../image-helpers.js';
import { registerImageUnderstandingProvider } from './provider-registry.js';
import type {
  ImageUnderstandingProvider,
  ImageUnderstandingRequest,
  ImageUnderstandingResult,
} from './types.js';

function resolveMaxTokens(modelMaxTokens: number | undefined, requestedMaxTokens = 4096): number {
  if (
    typeof modelMaxTokens !== 'number' ||
    !Number.isFinite(modelMaxTokens) ||
    modelMaxTokens <= 0
  ) {
    return requestedMaxTokens;
  }
  return Math.min(requestedMaxTokens, modelMaxTokens);
}

export function buildPiAiImageUnderstandingProvider(providerId: string): ImageUnderstandingProvider {
  return {
    id: providerId,
    label: `pi-ai (${providerId})`,
    async isConfigured() {
      const apiKey = await getApiKey(providerId);
      return Boolean(apiKey);
    },
    async describeImages(modelId, request) {
      const modelRef = `${providerId}/${modelId}`;
      const model = resolveModel(modelRef) as Model<Api>;
      if (!model.input?.includes('image')) {
        throw new Error(`Model does not support images: ${modelRef}`);
      }
      const apiKey = await getApiKey(providerId);
      if (!apiKey) {
        throw new Error(`No API key configured for provider: ${providerId}`);
      }

      const context: Context = {
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: request.prompt },
              ...request.images.map((img) => ({
                type: 'image' as const,
                data: img.buffer.toString('base64'),
                mimeType: img.mimeType || 'image/jpeg',
              })),
            ],
            timestamp: Date.now(),
          },
        ],
      };

      const maxTokens = resolveMaxTokens(model.maxTokens, request.maxTokens ?? 512);
      const timeoutMs = request.timeoutMs ?? 60_000;
      const timeoutSignal =
        typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
          ? AbortSignal.timeout(timeoutMs)
          : undefined;
      const signal = (() => {
        if (timeoutSignal && request.signal && typeof AbortSignal.any === 'function') {
          return AbortSignal.any([request.signal, timeoutSignal]);
        }
        if (request.signal) {
          return request.signal;
        }
        if (timeoutSignal) {
          return timeoutSignal;
        }
        const controller = new AbortController();
        setTimeout(() => controller.abort(), timeoutMs);
        return controller.signal;
      })();

      const message = await complete(model, context, {
        apiKey,
        maxTokens,
        signal,
      });

      const text = coerceImageAssistantText({
        message,
        provider: providerId,
        model: modelId,
      });
      return { text, provider: providerId, model: modelId };
    },
  };
}

for (const providerId of ['openai', 'anthropic', 'google', 'qwen']) {
  registerImageUnderstandingProvider(buildPiAiImageUnderstandingProvider(providerId));
}
