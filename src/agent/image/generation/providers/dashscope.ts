/**
 * Built-in DashScope (Alibaba Model Studio) image-generation provider.
 */
import {
  isProviderApiKeyConfigured,
  resolveApiKeyForProvider,
} from '../../../../providers/auth-runtime/index.js';
import {
  pickTimeoutMsOrFallback,
  postJsonRequest,
  privateNetworkPolicyToSsrfGuardOptions,
  resolveProviderHttpRequestConfig,
} from '../../../../media-shared/http/index.js';
import { createLogger } from '../../../../utils/logger.js';
import { imageFileExtensionForMimeType } from '../image-assets.js';
import type {
  ImageGenerationProvider,
  ImageGenerationProviderCapabilities,
  ImageGenerationRequest,
  ImageGenerationResult,
} from '../types.js';

const log = createLogger('ImageGen:DashScope');

/**
 * Wan image model ids for **HTTP synchronous** `multimodal-generation/generation`.
 * - **2.7** (`wan2.7-image-pro` / `wan2.7-image`): see Wan 2.7 image API (size presets 1K/2K/4K, `thinking_mode`, …).
 * - **2.6** (`wan2.6-t2i`): Wan 2.6 T2I (`prompt_extend`, pixel `宽*高`, …).
 * Wan 2.5 and earlier async-only models are not listed here.
 * @see https://www.alibabacloud.com/help/en/model-studio/wan-image-generation-and-editing-api-reference
 * @see https://www.alibabacloud.com/help/en/model-studio/text-to-image-v2-api-reference
 * @see https://www.alibabacloud.com/help/en/model-studio/model-pricing
 */
export const DASHSCOPE_IMAGE_MODELS: readonly string[] = [
  'wan2.7-image-pro',
  'wan2.7-image',
  'wan2.6-t2i',
];
export const DASHSCOPE_DEFAULT_IMAGE_MODEL = DASHSCOPE_IMAGE_MODELS[0]!;

const DEFAULT_TIMEOUT_MS = 180_000;

const DASHSCOPE_CAPABILITIES: ImageGenerationProviderCapabilities = {
  generate: { maxCount: 4, supportsSize: true },
  edit: { enabled: false },
  geometry: {
    sizes: ['2K', '1K', '4K', '1280x1280', '1024x1024', '1280x720', '720x1280', '1024x1536', '1536x1024'],
  },
  output: {
    formats: ['png', 'jpeg', 'webp'],
  },
};

/**
 * Official synchronous wan2.6 text-to-image endpoints. Each region uses its own API key.
 * @see https://www.alibabacloud.com/help/zh/model-studio/text-to-image-v2-api-reference
 */
export const DASHSCOPE_IMAGE_ENDPOINTS = {
  beijing: 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
  singapore: 'https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
} as const;

export type DashScopeImageRegion = keyof typeof DASHSCOPE_IMAGE_ENDPOINTS;

const DEFAULT_OUTPUT_MIME = 'image/png';

export function resolveDashScopeImageGenerationUrl(
  req: ImageGenerationRequest,
): string {
  const cfgBase = readDashScopeCfgString(req.cfg, 'baseUrl');
  if (cfgBase) return cfgBase.replace(/\/+$/, '');
  const region = readDashScopeCfgString(req.cfg, 'region');
  if (region === 'cn') return DASHSCOPE_IMAGE_ENDPOINTS.beijing;
  if (region === 'intl') return DASHSCOPE_IMAGE_ENDPOINTS.singapore;
  throw new Error('DashScope image generation requires providers.dashscope.region (cn or intl)');
}

function readDashScopeCfgString(
  cfg: ImageGenerationRequest['cfg'],
  key: string,
): string | undefined {
  const providers = (cfg as unknown as { providers?: Record<string, unknown> } | undefined)?.providers;
  if (!providers || typeof providers !== 'object') return undefined;
  const entry = (providers as Record<string, unknown>).dashscope;
  if (!entry || typeof entry !== 'object') return undefined;
  const v = (entry as Record<string, unknown>)[key];
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
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

export function isWan27ImageModel(model: string): boolean {
  const m = model.trim().toLowerCase();
  return m === 'wan2.7-image-pro' || m === 'wan2.7-image';
}

/**
 * Map tool `size` to Wan 2.7 `parameters.size` (1K / 2K / 4K presets or `宽*高` pixels).
 * `wan2.7-image` does not support 4K — falls back to 2K.
 */
export function mapSizeToWan27Format(size: string | undefined, modelId: string): string {
  const id = modelId.trim().toLowerCase();
  if (!size?.trim()) return '2K';
  const s = size.trim();
  const preset = s.toUpperCase();
  if (preset === '1K' || preset === '2K' || preset === '4K') {
    if (preset === '4K' && id === 'wan2.7-image') return '2K';
    return preset;
  }
  if (s.includes('*')) return s.replace(/\s/g, '');
  const dim = /^(\d+)\s*[xX]\s*(\d+)$/.exec(s);
  if (dim) return `${dim[1]}*${dim[2]}`;
  return '2K';
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
    const ext = imageFileExtensionForMimeType(mimeType);
    out.push({
      buffer: buf,
      mimeType,
      fileName: `image-${index}.${ext}`,
    });
  }
  return out;
}

export async function generateDashScopeImages(params: {
  req: ImageGenerationRequest;
  apiKey: string;
}): Promise<ImageGenerationResult> {
  const { req, apiKey } = params;
  const providerId = 'dashscope';
  if (req.inputImages && req.inputImages.length > 0) {
    throw new Error('Image-to-image is not supported for Qwen/DashScope in this build');
  }

  const n = Math.min(4, Math.max(1, req.count ?? 1));
  const model = req.model?.trim() || DASHSCOPE_DEFAULT_IMAGE_MODEL;
  const parameters = isWan27ImageModel(model)
    ? {
        size: mapSizeToWan27Format(req.size, model),
        n,
        watermark: false,
        thinking_mode: true,
      }
    : {
        prompt_extend: true,
        watermark: false,
        n,
        negative_prompt: '',
        size: mapSizeToDashScopeFormat(req.size),
      };

  const body = {
    model,
    input: {
      messages: [
        {
          role: 'user' as const,
          content: [{ text: req.prompt }],
        },
      ],
    },
    parameters,
  };

  const url = resolveDashScopeImageGenerationUrl(req);
  const httpDefaults = resolveProviderHttpRequestConfig({
    providerId,
    cfg: req.cfg,
    fallbackTimeoutMs: DEFAULT_TIMEOUT_MS,
  });

  log.debug(
    { providerId, model, url, count: n, phase: 'request' },
    'DashScope image generation request',
  );

  const timeoutMs = pickTimeoutMsOrFallback(req.timeoutMs, httpDefaults.timeoutMs, DEFAULT_TIMEOUT_MS);
  const response = await postJsonRequest(url, {
    label: providerId,
    timeoutMs,
    signal: req.signal,
    body,
    headers: {
      ...httpDefaults.headers,
      authorization: `Bearer ${apiKey}`,
    },
    ...privateNetworkPolicyToSsrfGuardOptions(),
  });

  let data: DashScopeT2IResponse;
  const rawText = await response.text();
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

  const assets = await fetchImageBuffers(urls, req.signal);
  return {
    images: assets,
    model,
  };
}

export function buildDashScopeImageGenerationProvider(): ImageGenerationProvider {
  return {
    id: 'dashscope',
    label: 'Alibaba Model Studio',
    documentationUrl: 'https://www.alibabacloud.com/help/en/model-studio/wan-image-generation-and-editing-api-reference',
    apiKeyUrl: 'https://dashscope.console.aliyun.com/apiKey',
    configFields: [
      {
        key: 'region',
        label: 'Service region',
        type: 'select',
        required: true,
        options: [{ value: 'cn', label: 'China' }, { value: 'intl', label: 'International' }],
      },
      { key: 'baseUrl', label: 'Base URL', type: 'url', placeholder: 'https://…' },
    ],
    defaultModel: DASHSCOPE_DEFAULT_IMAGE_MODEL,
    models: [...DASHSCOPE_IMAGE_MODELS],
    capabilities: DASHSCOPE_CAPABILITIES,
    isConfigured: (ctx) =>
      isProviderApiKeyConfigured({
        providerId: 'dashscope',
        cfg: ctx.cfg,
        agentId: ctx.agentId,
      }) &&
      ['cn', 'intl'].includes(readDashScopeCfgString(ctx.cfg, 'region') ?? ''),
    async generateImage(req) {
      const apiKey = resolveApiKeyForProvider({
        providerId: 'dashscope',
        cfg: req.cfg,
        agentId: req.agentId,
      });
      if (!apiKey) {
        throw new Error('DashScope API key missing (set DASHSCOPE_API_KEY or save a credential)');
      }
      return generateDashScopeImages({ req, apiKey });
    },
  };
}
