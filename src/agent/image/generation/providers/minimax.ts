/**
 * Built-in MiniMax image-generation provider.
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
import type {
  ImageGenerationProvider,
  ImageGenerationProviderCapabilities,
  ImageGenerationRequest,
  ImageGenerationResult,
} from '../types.js';

const log = createLogger('ImageGen:MiniMax');

/**
 * MiniMax `POST /v1/image_generation` model names (vendor OpenAPI enum).
 * Default: `image-01`. `image-01-live` is the alternate enum value on the same API.
 * @see https://platform.minimax.io/docs/api-reference/image-generation-i2i
 */
export const MINIMAX_IMAGE_MODELS: readonly string[] = ['image-01', 'image-01-live'];
export const MINIMAX_DEFAULT_IMAGE_MODEL = MINIMAX_IMAGE_MODELS[0]!;

/** CN region. */
const MINIMAX_CN_BASE_URL = 'https://api.minimaxi.com';
/** International region. */
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
  providerId: string,
  key: string,
): string | undefined {
  const providers = (cfg as unknown as { providers?: Record<string, unknown> } | undefined)?.providers;
  if (!providers || typeof providers !== 'object') return undefined;
  const entry = (providers as Record<string, unknown>)[providerId];
  if (!entry || typeof entry !== 'object') return undefined;
  const v = (entry as Record<string, unknown>)[key];
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

/**
 * Resolve MiniMax base URL:
 * 1. cfg.providers[providerId].baseUrl
 * 2. MINIMAX_BASE_URL env
 * 3. Provider default base URL
 */
export function resolveMinimaxBaseUrl(
  req: ImageGenerationRequest,
): string {
  const fromCfg = readMinimaxCfgString(req.cfg, 'minimax', 'baseUrl');
  if (fromCfg) return fromCfg.replace(/\/+$/, '');
  const fromEnv = process.env.MINIMAX_BASE_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/+$/, '');
  const region = readMinimaxCfgString(req.cfg, 'minimax', 'region');
  if (region === 'cn') return MINIMAX_CN_BASE_URL;
  if (region === 'intl') return MINIMAX_INTL_BASE_URL;
  throw new Error('MiniMax image generation requires providers.minimax.region (cn or intl)');
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
  const providerId = 'minimax';
  if (req.inputImages && req.inputImages.length > 0) {
    throw new Error('Image-to-image is not supported for MiniMax in this build');
  }

  const model = req.model?.trim() || MINIMAX_DEFAULT_IMAGE_MODEL;
  // Honour explicit aspectRatio first; fall back to size-derived mapping.
  const aspectRatio = req.aspectRatio?.trim() || mapSizeToMinimaxAspectRatio(req.size);

  const url = resolveMinimaxImageUrl(req);
  const httpDefaults = resolveProviderHttpRequestConfig({
    providerId,
    cfg: req.cfg,
    fallbackTimeoutMs: DEFAULT_TIMEOUT_MS,
  });

  log.debug(
    { providerId, model, url, aspectRatio, phase: 'request' },
    'MiniMax image generation request',
  );

  const timeoutMs = pickTimeoutMsOrFallback(req.timeoutMs, httpDefaults.timeoutMs, DEFAULT_TIMEOUT_MS);
  const res = await postJsonRequest(url, {
    label: providerId,
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
    models: [...MINIMAX_IMAGE_MODELS],
    capabilities: MINIMAX_CAPABILITIES,
    isConfigured: (ctx) =>
      isProviderApiKeyConfigured({
        providerId: 'minimax',
        cfg: ctx.cfg,
        agentId: ctx.agentId,
      }) &&
      ['cn', 'intl'].includes(readMinimaxCfgString(ctx.cfg, 'minimax', 'region') ?? ''),
    async generateImage(req) {
      const apiKey = resolveApiKeyForProvider({
        providerId: 'minimax',
        cfg: req.cfg,
        agentId: req.agentId,
      });
      if (!apiKey) {
        throw new Error('MiniMax API key missing (set MINIMAX_API_KEY or save a credential)');
      }
      return generateMinimaxImages({ req, apiKey });
    },
  };
}
