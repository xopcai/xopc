/**
 * Bundled MiniMax image-generation provider.
 *
 * Migrated from src/agent/image/generation/minimax-generate.ts. Logic stays
 * identical; only the registration pathway moves to the bundled generator.
 */
import {
  isProviderApiKeyConfigured,
  resolveApiKeyForProvider,
} from '@xopcai/xopc/providers/auth-runtime/index.js';
import {
  pickTimeoutMsOrFallback,
  postJsonRequest,
  privateNetworkPolicyToSsrfGuardOptions,
  resolveProviderHttpRequestConfig,
} from '@xopcai/xopc/media-shared/http/index.js';
import { createLogger } from '@xopcai/xopc/utils/logger.js';
import { MINIMAX_DEFAULT_IMAGE_MODEL } from '@xopcai/xopc/agent/image/generation/constants.js';
import type {
  ImageGenerationProvider,
  ImageGenerationProviderCapabilities,
  ImageGenerationRequest,
  ImageGenerationResult,
} from '@xopcai/xopc/agent/image/generation/types.js';

const log = createLogger('ImageGen:MiniMax');

/** CN region (default for `minimax` ids registered in mainland China). */
const MINIMAX_CN_BASE_URL = 'https://api.minimaxi.com';
/** International region (used when the configured key matches `*_INTL_*`). */
const MINIMAX_INTL_BASE_URL = 'https://api.minimax.io';

const DEFAULT_TIMEOUT_MS = 120_000;

const MINIMAX_CAPABILITIES: ImageGenerationProviderCapabilities = {
  generate: { maxCount: 1, supportsAspectRatio: true, supportsSize: false },
  edit: { enabled: false },
  geometry: { aspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4'] },
  output: { formats: ['jpeg'] },
};

function readMinimaxCfgString(
  cfg: ImageGenerationRequest['cfg'],
  key: string,
): string | undefined {
  const providers = (cfg as unknown as { providers?: Record<string, unknown> } | undefined)?.providers;
  if (!providers || typeof providers !== 'object') return undefined;
  const entry = (providers as Record<string, unknown>)['minimax'];
  if (!entry || typeof entry !== 'object') return undefined;
  const v = (entry as Record<string, unknown>)[key];
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

/**
 * Resolve MiniMax base URL with CN/Intl auto-detection:
 * 1. cfg.providers.minimax.baseUrl
 * 2. MINIMAX_BASE_URL env
 * 3. Auto: when MINIMAX_INTL_API_KEY env is the only key present, default to Intl;
 *    otherwise CN.
 */
export function resolveMinimaxBaseUrl(req: ImageGenerationRequest): string {
  const fromCfg = readMinimaxCfgString(req.cfg, 'baseUrl');
  if (fromCfg) return fromCfg.replace(/\/+$/, '');
  const fromEnv = process.env.MINIMAX_BASE_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/+$/, '');
  if (process.env.MINIMAX_INTL_API_KEY && !process.env.MINIMAX_API_KEY) {
    return MINIMAX_INTL_BASE_URL;
  }
  return MINIMAX_CN_BASE_URL;
}

function resolveMinimaxImageUrl(req: ImageGenerationRequest): string {
  return `${resolveMinimaxBaseUrl(req)}/v1/image_generation`;
}

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
  req: ImageGenerationRequest;
  apiKey: string;
}): Promise<ImageGenerationResult> {
  const { req, apiKey } = params;
  if (req.inputImages && req.inputImages.length > 0) {
    throw new Error('Image-to-image is not supported for MiniMax in this build');
  }

  const model = req.model?.trim() || MINIMAX_DEFAULT_IMAGE_MODEL;
  // Honour explicit aspectRatio first; fall back to size-derived mapping.
  const aspectRatio = req.aspectRatio?.trim() || mapSizeToMinimaxAspectRatio(req.size);

  const url = resolveMinimaxImageUrl(req);
  const httpDefaults = resolveProviderHttpRequestConfig({
    providerId: 'minimax',
    cfg: req.cfg,
    fallbackTimeoutMs: DEFAULT_TIMEOUT_MS,
  });

  log.debug(
    { providerId: 'minimax', model, url, aspectRatio, phase: 'request' },
    'MiniMax image generation request',
  );

  const timeoutMs = pickTimeoutMsOrFallback(req.timeoutMs, httpDefaults.timeoutMs, DEFAULT_TIMEOUT_MS);
  const res = await postJsonRequest(url, {
    label: 'minimax',
    timeoutMs,
    signal: req.signal,
    body: {
      model,
      prompt: req.prompt,
      aspect_ratio: aspectRatio,
      response_format: 'base64',
    },
    headers: {
      ...httpDefaults.headers,
      authorization: `Bearer ${apiKey}`,
    },
    ...privateNetworkPolicyToSsrfGuardOptions(),
  });

  const rawText = await res.text();
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
}

export function buildMinimaxImageGenerationProvider(): ImageGenerationProvider {
  return {
    id: 'minimax',
    label: 'MiniMax',
    defaultModel: MINIMAX_DEFAULT_IMAGE_MODEL,
    models: [MINIMAX_DEFAULT_IMAGE_MODEL],
    capabilities: MINIMAX_CAPABILITIES,
    isConfigured: (ctx) => isProviderApiKeyConfigured({ providerId: 'minimax', cfg: ctx.cfg }),
    async generateImage(req) {
      const apiKey = resolveApiKeyForProvider({ providerId: 'minimax', cfg: req.cfg });
      if (!apiKey) {
        throw new Error('MiniMax API key missing (MINIMAX_API_KEY or providers.minimax.apiKey)');
      }
      return generateMinimaxImages({ req, apiKey });
    },
  };
}
