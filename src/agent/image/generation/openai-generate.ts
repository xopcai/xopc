import { OPENAI_DEFAULT_IMAGE_MODEL } from './constants.js';
import {
  registerImageGenerationProvider,
  type ImageGenerationProvider,
} from './provider-registry.js';
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

function resolveOpenAIBaseUrl(): string {
  const fromEnv = process.env.OPENAI_BASE_URL?.trim();
  if (fromEnv) {
    return fromEnv.replace(/\/$/, '');
  }
  return DEFAULT_BASE;
}

function mapOpenAiImagesResponse(
  data: OpenAIImageApiResponse,
  model: string,
): ImageGenerationResult {
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
    model,
  };
}

export async function generateOpenAiImages(params: {
  apiKey: string;
  model: string;
  prompt: string;
  count?: number;
  size?: string;
  signal?: AbortSignal;
  inputImages?: ImageGenerationRequest['inputImages'];
}): Promise<ImageGenerationResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);
  const signal =
    params.signal && typeof AbortSignal !== 'undefined' && typeof AbortSignal.any === 'function'
      ? AbortSignal.any([params.signal, controller.signal])
      : params.signal ?? controller.signal;

  const model = params.model || OPENAI_DEFAULT_IMAGE_MODEL;
  const count = Math.min(4, Math.max(1, params.count ?? 1));
  const size = params.size?.trim() || DEFAULT_SIZE;
  const baseUrl = resolveOpenAIBaseUrl();
  const inputImages = params.inputImages ?? [];
  const isEdit = inputImages.length > 0;

  try {
    if (isEdit) {
      const form = new FormData();
      const first = inputImages[0]!;
      const bytes = new Uint8Array(first.buffer);
      const blob = new Blob([bytes], { type: first.mimeType || 'image/png' });
      const filename = first.fileName?.trim() || 'image.png';
      form.append('image', blob, filename);
      form.append('prompt', params.prompt);
      form.append('model', model);
      form.append('n', String(count));
      form.append('size', size);
      form.append('response_format', 'b64_json');

      const response = await fetch(`${baseUrl}/images/edits`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${params.apiKey}`,
        },
        body: form,
        signal,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`OpenAI image edit failed (${response.status}): ${text || response.statusText}`);
      }

      const data = (await response.json()) as OpenAIImageApiResponse;
      return mapOpenAiImagesResponse(data, model);
    }

    const response = await fetch(`${baseUrl}/images/generations`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${params.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        prompt: params.prompt,
        n: count,
        size,
        response_format: 'b64_json',
      }),
      signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`OpenAI image generation failed (${response.status}): ${text || response.statusText}`);
    }

    const data = (await response.json()) as OpenAIImageApiResponse;
    return mapOpenAiImagesResponse(data, model);
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
    inputImages: req.inputImages,
  });
}

export function buildOpenAIImageGenerationProvider(): ImageGenerationProvider {
  return {
    id: 'openai',
    label: 'OpenAI',
    defaultModel: OPENAI_DEFAULT_IMAGE_MODEL,
    models: [OPENAI_DEFAULT_IMAGE_MODEL, 'dall-e-3', 'dall-e-2'],
    capabilities: {
      supportsEdit: true,
      maxInputImages: 1,
      maxOutputImages: 4,
      supportedSizes: ['1024x1024', '1024x1536', '1536x1024'],
    },
    async isConfigured() {
      const { getApiKey } = await import('../../../providers/index.js');
      return Boolean(await getApiKey('openai'));
    },
    async generateImage(req) {
      const { getApiKey } = await import('../../../providers/index.js');
      const apiKey = await getApiKey('openai');
      if (!apiKey) {
        throw new Error('OpenAI API key missing');
      }
      return runOpenAiImageGeneration({
        ...req,
        apiKey,
      });
    },
  };
}

registerImageGenerationProvider(buildOpenAIImageGenerationProvider());
