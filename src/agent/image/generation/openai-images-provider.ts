/** Strict implementation of the OpenAI Images REST protocol. */

import { createLogger } from '../../../utils/logger.js';
import {
  pickTimeoutMsOrFallback,
  postJsonRequest,
  postMultipartRequest,
  privateNetworkPolicyToSsrfGuardOptions,
  readJsonResponseLimited,
  resolveProviderHttpRequestConfig,
} from '../../../media-shared/http/index.js';
import type { PrivateNetworkPolicy, SsrfGuardOptions } from '../../../media-shared/http/index.js';
import {
  imageAssetFromBase64,
  imageFileExtensionForMimeType,
} from './image-assets.js';
import type {
  GeneratedImageAsset,
  ImageGenerationProvider,
  ImageGenerationProviderCapabilities,
  ImageGenerationProviderConfiguredContext,
  ImageGenerationRequest,
  ImageGenerationResult,
  ImageGenerationSourceImage,
} from './types.js';

const log = createLogger('ImageGen:OpenAIImages');

const DEFAULT_OUTPUT_MIME = 'image/png';
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_RESPONSE_BYTES = 64 * 1024 * 1024;
const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 64 * 1024 * 1024;

/** Subset of the official OpenAI image response we map. */
export interface OpenAiImagesResponse {
  data?: Array<{
    b64_json?: string;
    revised_prompt?: string;
    [k: string]: unknown;
  }>;
  [k: string]: unknown;
}

export interface OpenAiImagesEndpointResolution {
  /** Base URL without trailing slash, e.g. `https://api.openai.com/v1`. */
  baseUrl: string;
  /** Optional override for the generations sub-path; defaults to `/images/generations`. */
  generationsPath?: string;
  /** Optional override for the edits sub-path; defaults to `/images/edits`. */
  editsPath?: string;
  /** Extra headers merged into the request (e.g. `api-key` for Azure). */
  headers?: Record<string, string>;
  /**
   * Override Authorization header logic. When omitted, the factory adds
   * `Authorization: Bearer <apiKey>` if `apiKey` is present.
   */
  authorization?: { kind: 'none' } | { kind: 'bearer' } | { kind: 'header'; headerName: string };
  /** Explicit private-host allowlist for this endpoint. Omit to use the global policy. */
  privateNetworkPolicy?: PrivateNetworkPolicy;
}

export interface OpenAiImagesProviderOptions {
  id: string;
  label: string;
  defaultModel: string;
  models: string[];
  capabilities: ImageGenerationProviderCapabilities;

  /** Sync env / cfg lookup that decides if the provider has any usable credential. */
  isConfigured: (ctx: ImageGenerationProviderConfiguredContext) => boolean;

  /** Resolve API key for one request. May return null when using OAuth/header auth. */
  resolveApiKey: (req: ImageGenerationRequest) => string | null | undefined;

  /** Resolve endpoint info per-request (region, baseUrl override, Azure deployment, …). */
  resolveEndpoint: (req: ImageGenerationRequest) => OpenAiImagesEndpointResolution;

  /** Default per-call timeout. Combined with provider-level config in provider-http. */
  defaultTimeoutMs?: number;

  /** Default count clamp. Provider may also enforce via `capabilities.generate.maxCount`. */
  defaultCount?: number;
  defaultSize?: string;
}

export function createOpenAiImagesProvider(
  options: OpenAiImagesProviderOptions,
): ImageGenerationProvider {
  const defaultMaxCount = options.capabilities.generate?.maxCount ?? 4;
  const defaultCount = options.defaultCount ?? 1;
  const defaultSize = options.defaultSize ?? '1024x1024';

  return {
    id: options.id,
    label: options.label,
    defaultModel: options.defaultModel,
    models: options.models,
    capabilities: options.capabilities,
    isConfigured: options.isConfigured,
    async generateImage(req): Promise<ImageGenerationResult> {
      const apiKey = options.resolveApiKey(req) ?? null;
      const endpoint = options.resolveEndpoint(req);
      const httpDefaults = resolveProviderHttpRequestConfig({
        providerId: options.id,
        cfg: req.cfg,
        fallbackTimeoutMs: options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS,
      });

      const headers: Record<string, string> = {
        ...httpDefaults.headers,
        ...(endpoint.headers ?? {}),
      };
      applyAuthorizationHeader({ headers, endpoint, apiKey });
      const ssrfGuardOptions = privateNetworkPolicyToSsrfGuardOptions(
        endpoint.privateNetworkPolicy,
      );

      const isEdit = (req.inputImages?.length ?? 0) > 0;
      const count = clampCount(req.count, defaultCount, defaultMaxCount);
      const size = req.size?.trim() || defaultSize;
      const url = isEdit
        ? joinPath(endpoint.baseUrl, endpoint.editsPath ?? '/images/edits')
        : joinPath(endpoint.baseUrl, endpoint.generationsPath ?? '/images/generations');

      log.debug(
        {
          providerId: options.id,
          model: req.model,
          phase: isEdit ? 'edit_request' : 'generate_request',
          count,
          size,
        },
        `OpenAI Images ${isEdit ? 'edit' : 'generate'} request`,
      );

      const responseJson = isEdit
        ? await postEditRequest({
            providerId: options.id,
            req,
            url,
            headers,
            count,
            size,
            httpDefaults,
            ssrfGuardOptions,
          })
        : await postGenerateRequest({
            providerId: options.id,
            req,
            url,
            headers,
            count,
            size,
            httpDefaults,
            ssrfGuardOptions,
          });

      const mapped = mapOpenAiImagesResponse(responseJson, req);
      if (mapped.length === 0) {
        throw new Error(`${options.id} returned no images.`);
      }
      return {
        images: mapped,
        model: req.model,
      };
    },
  };
}

// ============================================
// Default helpers
// ============================================

interface PostHelperParams {
  providerId: string;
  req: ImageGenerationRequest;
  url: string;
  headers: Record<string, string>;
  count: number;
  size: string;
  httpDefaults: { timeoutMs?: number };
  ssrfGuardOptions: SsrfGuardOptions;
}

async function postGenerateRequest(params: PostHelperParams): Promise<unknown> {
  const body: Record<string, unknown> = {
    model: params.req.model,
    prompt: params.req.prompt,
    n: params.count,
    size: params.size,
    response_format: 'b64_json',
  };
  applyOpenAiOptions(body, params.req);

  const timeoutMs = pickTimeoutMsOrFallback(
    params.req.timeoutMs,
    params.httpDefaults.timeoutMs,
    DEFAULT_TIMEOUT_MS,
  );
  const res = await postJsonRequest(params.url, {
    label: params.providerId,
    timeoutMs,
    signal: params.req.signal,
    body,
    headers: params.headers,
    ...params.ssrfGuardOptions,
  });
  return await readJsonResponseLimited(res, MAX_RESPONSE_BYTES);
}

async function postEditRequest(params: PostHelperParams): Promise<unknown> {
  const inputImages = params.req.inputImages ?? [];
  const fields: Record<string, string> = {
    model: params.req.model,
    prompt: params.req.prompt,
    n: String(params.count),
    size: params.size,
    response_format: 'b64_json',
  };
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (typeof v === 'string') form.append(k, v);
  }
  for (let idx = 0; idx < inputImages.length; idx++) {
    const img = inputImages[idx]!;
    const field = idx === 0 ? 'image' : `image[${idx}]`;
    const u8 = img.buffer instanceof Uint8Array ? img.buffer : new Uint8Array(img.buffer);
    const copy = new Uint8Array(u8.byteLength);
    copy.set(u8);
    form.append(
      field,
      new Blob([copy], { type: img.mimeType || DEFAULT_OUTPUT_MIME }),
      pickEditFileName(img, idx),
    );
  }

  const headers = new Headers(params.headers);
  headers.delete('content-type');

  const timeoutMs = pickTimeoutMsOrFallback(
    params.req.timeoutMs,
    params.httpDefaults.timeoutMs,
    DEFAULT_TIMEOUT_MS,
  );
  const res = await postMultipartRequest(params.url, {
    label: params.providerId,
    timeoutMs,
    signal: params.req.signal,
    body: form,
    headers,
    ...params.ssrfGuardOptions,
  });
  return await readJsonResponseLimited(res, MAX_RESPONSE_BYTES);
}

export function mapOpenAiImagesResponse(
  raw: unknown,
  req: ImageGenerationRequest,
): GeneratedImageAsset[] {
  if (!raw || typeof raw !== 'object') return [];
  const data = (raw as OpenAiImagesResponse).data;
  if (!Array.isArray(data)) return [];
  const ext = imageFileExtensionForMimeType(req.outputFormat ? `image/${req.outputFormat}` : DEFAULT_OUTPUT_MIME);
  const out: GeneratedImageAsset[] = [];
  let totalBytes = 0;
  data.forEach((entry, index) => {
    const b64 = entry?.b64_json;
    if (typeof b64 !== 'string' || b64.length === 0) return;
    const estimatedBytes = Math.ceil(b64.replace(/\s+/g, '').length * 3 / 4);
    if (estimatedBytes > MAX_IMAGE_BYTES) {
      throw new Error(`OpenAI Images response image exceeds ${MAX_IMAGE_BYTES} bytes.`);
    }
    totalBytes += estimatedBytes;
    if (totalBytes > MAX_TOTAL_IMAGE_BYTES) {
      throw new Error(`OpenAI Images response images exceed ${MAX_TOTAL_IMAGE_BYTES} bytes total.`);
    }
    const asset = imageAssetFromBase64({
      base64: b64,
      mimeType: req.outputFormat ? `image/${req.outputFormat}` : undefined,
      fileName: `image-${index + 1}.${ext}`,
    });
    out.push({
      ...asset,
      ...(typeof entry.revised_prompt === 'string' ? { revisedPrompt: entry.revised_prompt } : {}),
    });
  });
  return out;
}

// ============================================
// Local helpers
// ============================================

function applyAuthorizationHeader(params: {
  headers: Record<string, string>;
  endpoint: OpenAiImagesEndpointResolution;
  apiKey: string | null;
}): void {
  const auth = params.endpoint.authorization ?? { kind: 'bearer' as const };
  if (auth.kind === 'none') return;
  if (!params.apiKey) return;
  assertHttpHeaderValue(params.apiKey, 'API key');
  if (auth.kind === 'bearer') {
    params.headers['authorization'] = `Bearer ${params.apiKey}`;
    return;
  }
  if (auth.kind === 'header') {
    params.headers[auth.headerName.toLowerCase()] = params.apiKey;
  }
}

function assertHttpHeaderValue(value: string, label: string): void {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code > 255 || (code < 32 && code !== 9) || code === 127) {
      throw new Error(`${label} contains characters that cannot be sent in an HTTP header.`);
    }
  }
}

function applyOpenAiOptions(body: Record<string, unknown>, req: ImageGenerationRequest): void {
  if (req.quality) body.quality = req.quality;
  if (req.outputFormat) body.output_format = req.outputFormat;
  if (req.background) body.background = req.background;
  const opts = req.providerOptions?.openai;
  if (!opts) return;
  if (opts.moderation) body.moderation = opts.moderation;
  if (typeof opts.outputCompression === 'number') body.output_compression = opts.outputCompression;
  if (typeof opts.user === 'string' && opts.user) body.user = opts.user;
  if (opts.background && !body.background) body.background = opts.background;
}

function pickEditFileName(img: ImageGenerationSourceImage, idx: number): string {
  const safe = img.fileName?.trim().replace(/[^\w.-]/g, '_');
  if (safe) return safe;
  const ext = imageFileExtensionForMimeType(img.mimeType);
  return `image-${idx + 1}.${ext}`;
}

function clampCount(requested: number | undefined, fallback: number, max: number): number {
  if (typeof requested !== 'number' || !Number.isFinite(requested) || requested <= 0) return fallback;
  return Math.min(max, Math.max(1, Math.floor(requested)));
}

function joinPath(baseUrl: string, subPath: string): string {
  const left = baseUrl.replace(/\/+$/, '');
  const right = subPath.startsWith('/') ? subPath : `/${subPath}`;
  return `${left}${right}`;
}
