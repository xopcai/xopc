import { OPENAI_DEFAULT_IMAGE_MODEL } from './constants.js';
import type { ImageGenerationRequest, ImageGenerationResult } from './types.js';

const DEFAULT_BASE = 'https://api.openai.com/v1';
const DEFAULT_OUTPUT_MIME = 'image/png';
const DEFAULT_SIZE = '1024x1024';

type OpenAIImageApiResponse = {
  data?: Array<{
    b64_json?: string;
    revised_prompt?: string;
  }>;
};

function resolveOpenAiBaseUrl(): string {
  const fromEnv = process.env.OPENAI_BASE_URL?.trim();
  if (fromEnv) {
    return fromEnv.replace(/\/$/, '');
  }
  return DEFAULT_BASE;
}

export async function generateOpenAiImages(params: {
  apiKey: string;
  model: string;
  prompt: string;
  count?: number;
  size?: string;
  signal?: AbortSignal;
}): Promise<ImageGenerationResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);
  const signal =
    params.signal && typeof AbortSignal !== 'undefined' && typeof AbortSignal.any === 'function'
      ? AbortSignal.any([params.signal, controller.signal])
      : params.signal ?? controller.signal;

  try {
    const response = await fetch(`${resolveOpenAiBaseUrl()}/images/generations`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${params.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: params.model || OPENAI_DEFAULT_IMAGE_MODEL,
        prompt: params.prompt,
        n: Math.min(4, Math.max(1, params.count ?? 1)),
        size: params.size ?? DEFAULT_SIZE,
      }),
      signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`OpenAI image generation failed (${response.status}): ${text || response.statusText}`);
    }

    const data = (await response.json()) as OpenAIImageApiResponse;
    const images = (data.data ?? [])
      .map((entry, index) => {
        if (!entry.b64_json) {
          return null;
        }
        return {
          buffer: Buffer.from(entry.b64_json, 'base64'),
          mimeType: DEFAULT_OUTPUT_MIME,
          fileName: `image-${index + 1}.png`,
          ...(entry.revised_prompt ? { revisedPrompt: entry.revised_prompt } : {}),
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

    return {
      images,
      model: params.model || OPENAI_DEFAULT_IMAGE_MODEL,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function runOpenAiImageGeneration(req: ImageGenerationRequest & { apiKey: string }) {
  if (req.provider !== 'openai') {
    throw new Error(`Unsupported image generation provider: ${req.provider}`);
  }
  return generateOpenAiImages({
    apiKey: req.apiKey,
    model: req.model,
    prompt: req.prompt,
    count: req.count,
    size: req.size,
    signal: req.signal,
  });
}
