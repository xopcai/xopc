/**
 * Bundled Google Gemini image-generation provider.
 *
 * Uses the Gemini `generateContent` REST surface
 * (`https://generativelanguage.googleapis.com/v1beta/models/<model>:generateContent`)
 * with `responseModalities: ['TEXT', 'IMAGE']`, accepting Buffer-encoded
 * `inlineData` parts back. Supports both text-to-image (no inputImages) and
 * image-editing (one or more inputImages, sent as additional inlineData parts).
 *
 * Authentication: prefers `?key=<API_KEY>` query (the canonical Gemini surface);
 * falls back to `Authorization: Bearer` when the user explicitly configures an
 * OAuth-style key. Configure via env `GOOGLE_API_KEY` /
 * `GEMINI_API_KEY` / `GENERATIVE_LANGUAGE_API_KEY`, or via
 * `cfg.providers.google.apiKey`.
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
import {
  imageFileExtensionForMimeType,
} from '@xopcai/xopc/agent/image/generation/image-assets.js';
import type {
  ImageGenerationProvider,
  ImageGenerationProviderCapabilities,
  ImageGenerationRequest,
  ImageGenerationResult,
  ImageProviderUiMetadata,
} from '@xopcai/xopc/agent/image/generation/types.js';

const log = createLogger('ImageGen:Google');

const DEFAULT_GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com';
const GOOGLE_IMAGE_UI: ImageProviderUiMetadata = {
  baseUrlPresets: [{ value: DEFAULT_GEMINI_BASE_URL, label: 'Google AI (default)' }],
  baseUrlPresetKind: 'google',
};
const DEFAULT_GEMINI_API_VERSION = 'v1beta';
const DEFAULT_TIMEOUT_MS = 180_000;

/** Gemini image-capable model ids for this extension. */
export const GOOGLE_IMAGE_MODELS: readonly string[] = [
  'gemini-2.5-flash-image-preview',
  'gemini-3-pro-image-preview',
  'gemini-3-flash-image-preview',
];
export const GOOGLE_DEFAULT_IMAGE_MODEL = GOOGLE_IMAGE_MODELS[0]!;

const GOOGLE_CAPABILITIES: ImageGenerationProviderCapabilities = {
  generate: { maxCount: 4, supportsSize: true, supportsAspectRatio: true },
  edit: {
    enabled: true,
    maxInputImages: 5,
    supportsSize: true,
    supportsAspectRatio: true,
  },
  geometry: {
    sizes: ['1024x1024', '1024x1536', '1536x1024', '1024x1792', '1792x1024'],
    aspectRatios: ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'],
  },
  output: {
    formats: ['png', 'jpeg', 'webp'],
  },
};

function readGoogleCfgString(
  cfg: ImageGenerationRequest['cfg'],
  key: string,
): string | undefined {
  const providers = (cfg as unknown as { providers?: Record<string, unknown> } | undefined)
    ?.providers;
  if (!providers || typeof providers !== 'object') return undefined;
  const entry = (providers as Record<string, unknown>)['google'];
  if (!entry || typeof entry !== 'object') return undefined;
  const v = (entry as Record<string, unknown>)[key];
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

/**
 * Resolve Google Gemini base URL precedence:
 * 1. cfg.providers.google.baseUrl
 * 2. GEMINI_BASE_URL / GOOGLE_GENERATIVE_AI_BASE_URL env
 * 3. Default https://generativelanguage.googleapis.com
 */
export function resolveGoogleBaseUrl(req: ImageGenerationRequest): string {
  const fromCfg = readGoogleCfgString(req.cfg, 'baseUrl');
  if (fromCfg) return fromCfg.replace(/\/+$/, '');
  const fromEnv = (process.env.GEMINI_BASE_URL ?? process.env.GOOGLE_GENERATIVE_AI_BASE_URL)?.trim();
  if (fromEnv) return fromEnv.replace(/\/+$/, '');
  return DEFAULT_GEMINI_BASE_URL;
}

function resolveGoogleApiVersion(req: ImageGenerationRequest): string {
  const fromCfg = readGoogleCfgString(req.cfg, 'apiVersion');
  if (fromCfg) return fromCfg;
  const fromEnv = process.env.GEMINI_API_VERSION?.trim();
  if (fromEnv) return fromEnv;
  return DEFAULT_GEMINI_API_VERSION;
}

function resolveGoogleAuthMode(
  req: ImageGenerationRequest,
): 'query' | 'bearer' {
  const fromCfg = readGoogleCfgString(req.cfg, 'authMode');
  const v = (fromCfg ?? process.env.GEMINI_AUTH_MODE ?? '').trim().toLowerCase();
  if (v === 'bearer' || v === 'oauth') return 'bearer';
  return 'query';
}

type GeminiInlineData = { mimeType?: string; data?: string };
type GeminiPart =
  | { text?: string }
  | { inlineData?: GeminiInlineData }
  | { inline_data?: GeminiInlineData };
type GeminiCandidate = {
  content?: { parts?: GeminiPart[] };
  finishReason?: string;
};
type GeminiResponse = {
  candidates?: GeminiCandidate[];
  promptFeedback?: { blockReason?: string };
  error?: { code?: number; message?: string; status?: string };
};

function extractInlineData(part: GeminiPart): GeminiInlineData | undefined {
  if (part && typeof part === 'object') {
    if ('inlineData' in part && part.inlineData) return part.inlineData;
    if ('inline_data' in part && part.inline_data) return part.inline_data;
  }
  return undefined;
}

export async function generateGoogleImages(params: {
  req: ImageGenerationRequest;
  apiKey: string;
}): Promise<ImageGenerationResult> {
  const { req, apiKey } = params;
  const model = req.model?.trim() || GOOGLE_DEFAULT_IMAGE_MODEL;
  const apiVersion = resolveGoogleApiVersion(req);
  const baseUrl = resolveGoogleBaseUrl(req);
  const authMode = resolveGoogleAuthMode(req);

  // Build prompt parts: text + (optional) input images.
  const userParts: GeminiPart[] = [{ text: req.prompt }];
  for (const image of req.inputImages ?? []) {
    const mimeType = image.mimeType?.trim() || 'image/png';
    userParts.push({
      inlineData: {
        mimeType,
        data: Buffer.from(image.buffer).toString('base64'),
      },
    });
  }

  // Honour both aspectRatio and size as hints. Gemini does not enforce a strict
  // schema for these values; pass them under generationConfig.imageConfig where
  // the backend understands them, plus echo them in the prompt as a safety net.
  const generationConfig: Record<string, unknown> = {
    responseModalities: ['TEXT', 'IMAGE'],
  };
  const imageConfig: Record<string, unknown> = {};
  if (req.aspectRatio?.trim()) {
    imageConfig.aspectRatio = req.aspectRatio.trim();
  }
  if (req.size?.trim()) {
    imageConfig.size = req.size.trim();
  }
  if (req.outputFormat?.trim()) {
    imageConfig.outputFormat = req.outputFormat.trim();
  }
  if (Object.keys(imageConfig).length > 0) {
    generationConfig.imageConfig = imageConfig;
  }

  const candidateCount = Math.max(1, Math.min(4, req.count ?? 1));
  if (candidateCount > 1) {
    generationConfig.candidateCount = candidateCount;
  }

  const body = {
    contents: [{ role: 'user', parts: userParts }],
    generationConfig,
  };

  const baseEndpoint = `${baseUrl}/${apiVersion}/models/${encodeURIComponent(model)}:generateContent`;
  const url =
    authMode === 'query'
      ? `${baseEndpoint}?key=${encodeURIComponent(apiKey)}`
      : baseEndpoint;

  const httpDefaults = resolveProviderHttpRequestConfig({
    providerId: 'google',
    cfg: req.cfg,
    fallbackTimeoutMs: DEFAULT_TIMEOUT_MS,
  });

  const headers: Record<string, string> = { ...httpDefaults.headers };
  if (authMode === 'bearer') {
    headers.authorization = `Bearer ${apiKey}`;
  }

  log.debug(
    {
      providerId: 'google',
      model,
      url: baseEndpoint,
      authMode,
      candidateCount,
      inputImages: (req.inputImages ?? []).length,
      phase: 'request',
    },
    'Google Gemini image generation request',
  );

  const timeoutMs = pickTimeoutMsOrFallback(req.timeoutMs, httpDefaults.timeoutMs, DEFAULT_TIMEOUT_MS);
  const res = await postJsonRequest(url, {
    label: 'google',
    timeoutMs,
    signal: req.signal,
    body,
    headers,
    ...privateNetworkPolicyToSsrfGuardOptions(),
  });

  const rawText = await res.text();
  let data: GeminiResponse;
  try {
    data = JSON.parse(rawText) as GeminiResponse;
  } catch {
    throw new Error(`Google Gemini returned non-JSON: ${rawText.slice(0, 240)}`);
  }

  if (data.error) {
    const code = data.error.code ?? data.error.status ?? 'UNKNOWN';
    throw new Error(`Google Gemini: ${code}: ${data.error.message ?? 'request failed'}`);
  }
  if (data.promptFeedback?.blockReason) {
    throw new Error(`Google Gemini blocked prompt: ${data.promptFeedback.blockReason}`);
  }

  const collected: Array<{ buffer: Buffer; mimeType: string; fileName: string }> = [];
  let index = 0;
  for (const candidate of data.candidates ?? []) {
    for (const part of candidate.content?.parts ?? []) {
      const inline = extractInlineData(part);
      if (!inline?.data) continue;
      const mimeType = inline.mimeType?.trim() || 'image/png';
      const buffer = Buffer.from(inline.data, 'base64');
      if (buffer.length === 0) continue;
      index += 1;
      const ext = imageFileExtensionForMimeType(mimeType);
      collected.push({
        buffer,
        mimeType,
        fileName: `image-${index}.${ext}`,
      });
    }
  }

  if (collected.length === 0) {
    const finishReason = data.candidates?.[0]?.finishReason ?? 'unknown';
    throw new Error(
      `Google Gemini returned no image data (finishReason=${finishReason}). ` +
        'Verify the model id supports image output.',
    );
  }

  return { images: collected, model };
}

export function buildGoogleImageGenerationProvider(): ImageGenerationProvider {
  return {
    id: 'google',
    aliases: ['gemini'],
    label: 'Google Gemini',
    defaultModel: GOOGLE_DEFAULT_IMAGE_MODEL,
    models: [...GOOGLE_IMAGE_MODELS],
    capabilities: GOOGLE_CAPABILITIES,
    ui: GOOGLE_IMAGE_UI,
    isConfigured: (ctx) =>
      isProviderApiKeyConfigured({ providerId: 'google', cfg: ctx.cfg }),
    async generateImage(req) {
      const apiKey = resolveApiKeyForProvider({ providerId: 'google', cfg: req.cfg });
      if (!apiKey) {
        throw new Error(
          'Google Gemini API key missing (set GOOGLE_API_KEY / GEMINI_API_KEY or providers.google.apiKey)',
        );
      }
      return generateGoogleImages({ req, apiKey });
    },
  };
}
