/**
 * OpenAI-compatible image provider factory.
 *
 * Many image providers (OpenAI, Azure OpenAI, OpenAI-compatible gateways)
 * speak the same `/images/generations` and `/images/edits` REST shape.
 * This factory wraps that wire format on top of `provider-http`, normalization,
 * and auth-runtime so vendor modules only need to declare:
 *   - id / aliases / models / capabilities
 *   - baseUrl resolution
 *   - apiKey resolution
 *   - optional request body / response transforms
 *
 * Step 2 keeps the factory inside `src/agent/image/generation/`. Step 3 will
 * lift it to a stable path that vendor extensions can import without the
 * deep relative path.
 */

import { createLogger } from '../../../utils/logger.js';
import {
  postJsonRequest,
  postMultipartRequest,
  resolveProviderHttpRequestConfig,
} from '../../../providers/http/index.js';
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

const log = createLogger('ImageGen:OpenAICompat');

const DEFAULT_OUTPUT_MIME = 'image/png';
const DEFAULT_TIMEOUT_MS = 120_000;

/** Subset of the official OpenAI image response we map. */
export interface OpenAiCompatibleImageResponse {
  data?: Array<{
    b64_json?: string;
    revised_prompt?: string;
    [k: string]: unknown;
  }>;
  [k: string]: unknown;
}

export interface OpenAiCompatibleEndpointResolution {
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
}

export interface OpenAiCompatibleImageProviderOptions {
  id: string;
  aliases?: string[];
  label?: string;
  defaultModel: string;
  models: string[];
  capabilities: ImageGenerationProviderCapabilities;

  /** Sync env / cfg lookup that decides if the provider has any usable credential. */
  isConfigured: (ctx: ImageGenerationProviderConfiguredContext) => boolean;

  /** Resolve API key for one request. May return null when using OAuth/header auth. */
  resolveApiKey: (req: ImageGenerationRequest) => string | null | undefined;

  /** Resolve endpoint info per-request (region, baseUrl override, Azure deployment, …). */
  resolveEndpoint: (req: ImageGenerationRequest) => OpenAiCompatibleEndpointResolution;

  /** Default per-call timeout. Combined with provider-level config in provider-http. */
  defaultTimeoutMs?: number;

  /**
   * Hook to enrich the JSON body sent to `/images/generations`. Mutate the
   * returned object freely; the factory keeps standard fields stable.
   */
  buildGenerateRequestBody?: (
    req: ImageGenerationRequest,
    base: Record<string, unknown>,
  ) => Record<string, unknown>;

  /** Hook to enrich the multipart form for `/images/edits`. */
  buildEditFormFields?: (
    req: ImageGenerationRequest,
    fields: Record<string, string>,
  ) => Record<string, string>;

  /**
   * Optional response mapper. Default: `mapDefaultOpenAiResponse`. Vendor
   * implementations can override to handle non-standard response shapes.
   */
  mapResponse?: (raw: unknown, req: ImageGenerationRequest) => GeneratedImageAsset[];

  /** Default count clamp. Provider may also enforce via `capabilities.generate.maxCount`. */
  defaultCount?: number;
  defaultSize?: string;
}

export function createOpenAiCompatibleImageProvider(
  options: OpenAiCompatibleImageProviderOptions,
): ImageGenerationProvider {
  const defaultMaxCount = options.capabilities.generate?.maxCount ?? 4;
  const defaultCount = options.defaultCount ?? 1;
  const defaultSize = options.defaultSize ?? '1024x1024';

  return {
    id: options.id,
    ...(options.aliases ? { aliases: options.aliases } : {}),
    ...(options.label ? { label: options.label } : {}),
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
        `OpenAI-compatible ${isEdit ? 'edit' : 'generate'} request`,
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
            buildEditFormFields: options.buildEditFormFields,
          })
        : await postGenerateRequest({
            providerId: options.id,
            req,
            url,
            headers,
            count,
            size,
            httpDefaults,
            buildGenerateRequestBody: options.buildGenerateRequestBody,
          });

      const mapped = (options.mapResponse ?? mapDefaultOpenAiResponse)(responseJson, req);
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
}

async function postGenerateRequest(
  params: PostHelperParams & {
    buildGenerateRequestBody?: OpenAiCompatibleImageProviderOptions['buildGenerateRequestBody'];
  },
): Promise<unknown> {
  const baseBody: Record<string, unknown> = {
    model: params.req.model,
    prompt: params.req.prompt,
    n: params.count,
    size: params.size,
    response_format: 'b64_json',
  };
  applyOpenAiOptions(baseBody, params.req);
  const body = params.buildGenerateRequestBody
    ? params.buildGenerateRequestBody(params.req, baseBody)
    : baseBody;

  const res = await postJsonRequest({
    providerId: params.providerId,
    url: params.url,
    body,
    headers: params.headers,
    timeoutMs: params.req.timeoutMs,
    providerDefaultTimeoutMs: params.httpDefaults.timeoutMs,
    signal: params.req.signal,
  });
  return await res.json();
}

async function postEditRequest(
  params: PostHelperParams & {
    buildEditFormFields?: OpenAiCompatibleImageProviderOptions['buildEditFormFields'];
  },
): Promise<unknown> {
  const inputImages = params.req.inputImages ?? [];
  const fields: Record<string, string> = {
    model: params.req.model,
    prompt: params.req.prompt,
    n: String(params.count),
    size: params.size,
    response_format: 'b64_json',
  };
  const merged = params.buildEditFormFields
    ? params.buildEditFormFields(params.req, fields)
    : fields;

  const res = await postMultipartRequest({
    providerId: params.providerId,
    url: params.url,
    headers: params.headers,
    fields: merged,
    files: inputImages.map((img, idx) => ({
      field: idx === 0 ? 'image' : `image[${idx}]`,
      buffer: img.buffer,
      mimeType: img.mimeType || DEFAULT_OUTPUT_MIME,
      fileName: pickEditFileName(img, idx),
    })),
    timeoutMs: params.req.timeoutMs,
    providerDefaultTimeoutMs: params.httpDefaults.timeoutMs,
    signal: params.req.signal,
  });
  return await res.json();
}

export function mapDefaultOpenAiResponse(
  raw: unknown,
  req: ImageGenerationRequest,
): GeneratedImageAsset[] {
  if (!raw || typeof raw !== 'object') return [];
  const data = (raw as OpenAiCompatibleImageResponse).data;
  if (!Array.isArray(data)) return [];
  const ext = imageFileExtensionForMimeType(req.outputFormat ? `image/${req.outputFormat}` : DEFAULT_OUTPUT_MIME);
  const out: GeneratedImageAsset[] = [];
  data.forEach((entry, index) => {
    const b64 = entry?.b64_json;
    if (typeof b64 !== 'string' || b64.length === 0) return;
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
  endpoint: OpenAiCompatibleEndpointResolution;
  apiKey: string | null;
}): void {
  const auth = params.endpoint.authorization ?? { kind: 'bearer' as const };
  if (auth.kind === 'none') return;
  if (!params.apiKey) return;
  if (auth.kind === 'bearer') {
    params.headers['authorization'] = `Bearer ${params.apiKey}`;
    return;
  }
  if (auth.kind === 'header') {
    params.headers[auth.headerName.toLowerCase()] = params.apiKey;
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
