import { QWEN_DEFAULT_IMAGE_MODEL } from './constants.js';
import type { ImageGenerationRequest, ImageGenerationResult } from './types.js';

/**
 * Official synchronous wan2.6 text-to-image endpoints. Each region uses its own API key
 * (do not mix Beijing keys with international endpoints).
 * @see https://www.alibabacloud.com/help/zh/model-studio/text-to-image-v2-api-reference
 */
export const DASHSCOPE_IMAGE_ENDPOINTS = {
  beijing: 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
  singapore: 'https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
  us: 'https://dashscope-us.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
} as const;

export type DashScopeImageRegion = keyof typeof DASHSCOPE_IMAGE_ENDPOINTS;

const DEFAULT_OUTPUT_MIME = 'image/png';

/**
 * Resolves region from `DASHSCOPE_REGION` or `DASHSCOPE_IMAGE_REGION` (ignored when
 * `DASHSCOPE_IMAGE_BASE_URL` is set).
 */
export function resolveDashScopeImageRegion(): DashScopeImageRegion {
  const raw = (process.env.DASHSCOPE_REGION ?? process.env.DASHSCOPE_IMAGE_REGION ?? '')
    .trim()
    .toLowerCase();
  if (!raw) {
    return 'beijing';
  }
  if (['beijing', 'cn', 'china', 'bj'].includes(raw)) {
    return 'beijing';
  }
  if (['singapore', 'sg', 'intl', 'international', 'sea', 'ap-southeast-1'].includes(raw)) {
    return 'singapore';
  }
  if (['us', 'virginia', 'va', 'us-east-1'].includes(raw)) {
    return 'us';
  }
  return 'beijing';
}

/**
 * Full URL for DashScope image generation. Precedence:
 * 1. `DASHSCOPE_IMAGE_BASE_URL` — explicit endpoint (any region).
 * 2. Otherwise `DASHSCOPE_REGION` / `DASHSCOPE_IMAGE_REGION` → {@link DASHSCOPE_IMAGE_ENDPOINTS} (default Beijing).
 */
export function resolveDashScopeImageGenerationUrl(): string {
  const trimmed = process.env.DASHSCOPE_IMAGE_BASE_URL?.trim();
  if (trimmed) {
    return trimmed.replace(/\/$/, '');
  }
  const region = resolveDashScopeImageRegion();
  return DASHSCOPE_IMAGE_ENDPOINTS[region];
}

/** Map tool size (e.g. `1024x1024`) to DashScope `宽*高` format. */
export function mapSizeToDashScopeFormat(size?: string): string {
  if (!size?.trim()) {
    return '1280*1280';
  }
  const s = size.trim();
  if (s.includes('*')) {
    return s.replace(/\s/g, '');
  }
  const m = /^(\d+)\s*[xX]\s*(\d+)$/.exec(s);
  if (m) {
    return `${m[1]}*${m[2]}`;
  }
  return '1280*1280';
}

type DashScopeT2IResponse = {
  code?: string;
  message?: string;
  output?: {
    choices?: Array<{
      message?: {
        content?: Array<{ type?: string; image?: string; text?: string }>;
      };
    }>;
  };
};

function collectImageUrls(data: DashScopeT2IResponse): string[] {
  const urls: string[] = [];
  for (const choice of data.output?.choices ?? []) {
    for (const item of choice.message?.content ?? []) {
      if (item.type === 'image' && typeof item.image === 'string' && item.image.length > 0) {
        urls.push(item.image);
      }
    }
  }
  return urls;
}

async function fetchImageBuffers(
  urls: string[],
  signal: AbortSignal | undefined,
): Promise<Array<{ buffer: Buffer; mimeType: string; fileName: string }>> {
  const out: Array<{ buffer: Buffer; mimeType: string; fileName: string }> = [];
  let index = 0;
  for (const url of urls) {
    index += 1;
    const res = await fetch(url, { redirect: 'follow', signal });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`Failed to download generated image (${res.status}): ${t || res.statusText}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const ct = res.headers.get('content-type') || '';
    const mimeType = ct.split(';')[0]?.trim() || DEFAULT_OUTPUT_MIME;
    out.push({
      buffer: buf,
      mimeType,
      fileName: `image-${index}.png`,
    });
  }
  return out;
}

export async function generateDashScopeImages(params: {
  apiKey: string;
  model: string;
  prompt: string;
  count?: number;
  size?: string;
  signal?: AbortSignal;
}): Promise<ImageGenerationResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180_000);
  const signal =
    params.signal && typeof AbortSignal !== 'undefined' && typeof AbortSignal.any === 'function'
      ? AbortSignal.any([params.signal, controller.signal])
      : params.signal ?? controller.signal;

  try {
    const n = Math.min(4, Math.max(1, params.count ?? 1));
    const model = params.model?.trim() || QWEN_DEFAULT_IMAGE_MODEL;
    const body = {
      model,
      input: {
        messages: [
          {
            role: 'user' as const,
            content: [{ text: params.prompt }],
          },
        ],
      },
      parameters: {
        prompt_extend: true,
        watermark: false,
        n,
        negative_prompt: '',
        size: mapSizeToDashScopeFormat(params.size),
      },
    };

    const response = await fetch(resolveDashScopeImageGenerationUrl(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${params.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal,
    });

    const rawText = await response.text();
    if (!response.ok) {
      throw new Error(`DashScope image generation failed (${response.status}): ${rawText || response.statusText}`);
    }

    let data: DashScopeT2IResponse;
    try {
      data = JSON.parse(rawText) as DashScopeT2IResponse;
    } catch {
      throw new Error(`DashScope returned non-JSON: ${rawText.slice(0, 240)}`);
    }

    if (!data.output?.choices?.length) {
      if (data.message || data.code) {
        throw new Error(
          data.code
            ? `DashScope: ${data.code}: ${data.message ?? ''}`
            : `DashScope: ${data.message ?? 'unknown error'}`,
        );
      }
      throw new Error('DashScope returned no output');
    }

    const urls = collectImageUrls(data);
    if (urls.length === 0) {
      throw new Error('DashScope returned no image URLs in response');
    }

    const assets = await fetchImageBuffers(urls, signal);
    return {
      images: assets,
      model,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function runDashScopeImageGeneration(req: ImageGenerationRequest & { apiKey: string }) {
  if (req.provider !== 'qwen') {
    throw new Error(`Unsupported image generation provider: ${req.provider}`);
  }
  return generateDashScopeImages({
    apiKey: req.apiKey,
    model: req.model,
    prompt: req.prompt,
    count: req.count,
    size: req.size,
    signal: req.signal,
  });
}
