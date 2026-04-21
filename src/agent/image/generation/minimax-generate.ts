import { MINIMAX_DEFAULT_IMAGE_MODEL } from './constants.js';
import {
  registerImageGenerationProvider,
  type ImageGenerationProvider,
} from './provider-registry.js';
import type { ImageGenerationRequest, ImageGenerationResult } from './types.js';

const MINIMAX_IMAGE_URL = 'https://api.minimaxi.com/v1/image_generation';

export type MinimaxAspectRatio = '1:1' | '16:9' | '9:16' | '4:3' | '3:4';

/** Map tool size (e.g. `1024x1024`) to the closest MiniMax-supported aspect ratio. */
export function mapSizeToMinimaxAspectRatio(size?: string): MinimaxAspectRatio {
  if (!size?.trim()) {
    return '1:1';
  }
  const m = /^(\d+)\s*[xX]\s*(\d+)$/.exec(size.trim());
  if (!m) {
    return '1:1';
  }
  const w = Number(m[1]);
  const h = Number(m[2]);
  if (!Number.isFinite(w) || !Number.isFinite(h) || h === 0) {
    return '1:1';
  }
  const ratio = w / h;
  const candidates: Array<{ ar: MinimaxAspectRatio; r: number }> = [
    { ar: '1:1', r: 1 },
    { ar: '16:9', r: 16 / 9 },
    { ar: '9:16', r: 9 / 16 },
    { ar: '4:3', r: 4 / 3 },
    { ar: '3:4', r: 3 / 4 },
  ];
  let best = candidates[0]!;
  let bestDiff = Math.abs(ratio - best.r);
  for (const c of candidates.slice(1)) {
    const d = Math.abs(ratio - c.r);
    if (d < bestDiff) {
      best = c;
      bestDiff = d;
    }
  }
  return best.ar;
}

type MiniMaxImageResponse = {
  data?: { image_base64?: string[] };
  base_resp?: { status_code?: number; status_msg?: string };
};

export async function generateMinimaxImages(params: {
  apiKey: string;
  model: string;
  prompt: string;
  size?: string;
  signal?: AbortSignal;
  inputImages?: ImageGenerationRequest['inputImages'];
}): Promise<ImageGenerationResult> {
  if (params.inputImages && params.inputImages.length > 0) {
    throw new Error('Image-to-image is not supported for MiniMax in this build');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);
  const signal =
    params.signal && typeof AbortSignal !== 'undefined' && typeof AbortSignal.any === 'function'
      ? AbortSignal.any([params.signal, controller.signal])
      : params.signal ?? controller.signal;

  const model = params.model?.trim() || MINIMAX_DEFAULT_IMAGE_MODEL;
  const aspectRatio = mapSizeToMinimaxAspectRatio(params.size);

  try {
    const res = await fetch(MINIMAX_IMAGE_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${params.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        prompt: params.prompt,
        aspect_ratio: aspectRatio,
        response_format: 'base64',
      }),
      signal,
    });

    const rawText = await res.text();
    if (!res.ok) {
      throw new Error(`MiniMax image generation failed (${res.status}): ${rawText || res.statusText}`);
    }

    let data: MiniMaxImageResponse;
    try {
      data = JSON.parse(rawText) as MiniMaxImageResponse;
    } catch {
      throw new Error(`MiniMax returned non-JSON: ${rawText.slice(0, 240)}`);
    }

    const code = data.base_resp?.status_code;
    if (code !== undefined && code !== 0) {
      throw new Error(
        `MiniMax: ${code}: ${data.base_resp?.status_msg ?? 'request failed'}`.trim(),
      );
    }

    const imageBase64List = data.data?.image_base64 ?? [];
    if (imageBase64List.length === 0) {
      throw new Error('MiniMax returned no images');
    }

    const images = imageBase64List.map((b64, index) => ({
      buffer: Buffer.from(b64, 'base64'),
      mimeType: 'image/jpeg',
      fileName: `image-${index + 1}.jpg`,
    }));

    return { images, model };
  } finally {
    clearTimeout(timeout);
  }
}

export async function runMinimaxImageGeneration(req: ImageGenerationRequest & { apiKey: string }) {
  if (req.provider !== 'minimax') {
    throw new Error(`Unsupported image generation provider: ${req.provider}`);
  }
  return generateMinimaxImages({
    apiKey: req.apiKey,
    model: req.model,
    prompt: req.prompt,
    size: req.size,
    signal: req.signal,
    inputImages: req.inputImages,
  });
}

export function buildMinimaxImageGenerationProvider(): ImageGenerationProvider {
  return {
    id: 'minimax',
    label: 'MiniMax',
    defaultModel: MINIMAX_DEFAULT_IMAGE_MODEL,
    models: [MINIMAX_DEFAULT_IMAGE_MODEL],
    capabilities: {
      supportsEdit: false,
      maxOutputImages: 1,
      supportedSizes: ['1:1', '16:9', '9:16', '4:3', '3:4'],
    },
    async isConfigured() {
      const { getApiKey } = await import('../../../providers/index.js');
      return Boolean(await getApiKey('minimax'));
    },
    async generateImage(req) {
      const { getApiKey } = await import('../../../providers/index.js');
      const apiKey = await getApiKey('minimax');
      if (!apiKey) {
        throw new Error('MiniMax API key missing (MINIMAX_API_KEY)');
      }
      return runMinimaxImageGeneration({ ...req, apiKey });
    },
  };
}

registerImageGenerationProvider(buildMinimaxImageGenerationProvider());
