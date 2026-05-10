/**
 * Bundled Fal.ai image-generation provider.
 *
 * Fal.ai is queue-based:
 *   1. POST https://queue.fal.run/<model>           → { request_id, status_url, response_url }
 *   2. GET  status_url (poll)                       → { status: IN_QUEUE | IN_PROGRESS | COMPLETED | … }
 *   3. GET  response_url (after COMPLETED)          → { images: [{ url, content_type, … }], … }
 *   4. fetch each images[].url                      → bytes
 *
 * Auth: `Authorization: Key <FAL_KEY>` (Fal's REST convention).
 * Configure via env `FAL_KEY` / `FAL_API_KEY` or `cfg.providers.fal.apiKey`.
 *
 * Polling stays inside `req.timeoutMs` (default 600s for queue + inference);
 * exceeding it surfaces a clear error rather than hanging forever.
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

const log = createLogger('ImageGen:Fal');

const DEFAULT_FAL_QUEUE_BASE_URL = 'https://queue.fal.run';
const FAL_IMAGE_UI: ImageProviderUiMetadata = {
  baseUrlPresets: [
    { value: DEFAULT_FAL_QUEUE_BASE_URL, label: 'Fal queue (default)' },
    { value: 'https://fal.run', label: 'Fal direct (fal.run)' },
  ],
  baseUrlPresetKind: 'fal',
};
export const FAL_DEFAULT_IMAGE_MODEL = 'fal-ai/flux/schnell';
const DEFAULT_TIMEOUT_MS = 600_000; // queue + inference (10 min)
const DEFAULT_POLL_INTERVAL_MS = 1500;
const MAX_POLL_INTERVAL_MS = 5000;

export const FAL_IMAGE_MODELS: readonly string[] = [
  FAL_DEFAULT_IMAGE_MODEL,
  'fal-ai/flux/dev',
  'fal-ai/flux-pro/v1.1',
  'fal-ai/flux-pro/v1.1-ultra',
  'fal-ai/nano-banana',
];

const FAL_CAPABILITIES: ImageGenerationProviderCapabilities = {
  generate: { maxCount: 4, supportsSize: true, supportsAspectRatio: true },
  edit: {
    enabled: true,
    maxInputImages: 4,
    supportsSize: true,
    supportsAspectRatio: true,
  },
  geometry: {
    sizes: ['1024x1024', '1024x1536', '1536x1024', '1024x1792', '1792x1024'],
    aspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4', '21:9'],
  },
  output: {
    formats: ['png', 'jpeg', 'webp'],
  },
};

function readFalCfgString(
  cfg: ImageGenerationRequest['cfg'],
  key: string,
): string | undefined {
  const providers = (cfg as unknown as { providers?: Record<string, unknown> } | undefined)
    ?.providers;
  if (!providers || typeof providers !== 'object') return undefined;
  const entry = (providers as Record<string, unknown>)['fal'];
  if (!entry || typeof entry !== 'object') return undefined;
  const v = (entry as Record<string, unknown>)[key];
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

/**
 * Resolve Fal queue base URL precedence:
 * 1. cfg.providers.fal.baseUrl
 * 2. FAL_QUEUE_BASE_URL / FAL_BASE_URL env
 * 3. Default https://queue.fal.run
 */
export function resolveFalBaseUrl(req: ImageGenerationRequest): string {
  const fromCfg = readFalCfgString(req.cfg, 'baseUrl');
  if (fromCfg) return fromCfg.replace(/\/+$/, '');
  const fromEnv = (process.env.FAL_QUEUE_BASE_URL ?? process.env.FAL_BASE_URL)?.trim();
  if (fromEnv) return fromEnv.replace(/\/+$/, '');
  return DEFAULT_FAL_QUEUE_BASE_URL;
}

type FalSubmitResponse = {
  request_id?: string;
  status_url?: string;
  response_url?: string;
  cancel_url?: string;
  queue_position?: number;
};

type FalStatusResponse = {
  status?: 'IN_QUEUE' | 'IN_PROGRESS' | 'COMPLETED' | string;
  request_id?: string;
  response_url?: string;
  queue_position?: number;
  error?: string;
  error_type?: string;
  metrics?: { inference_time?: number };
};

type FalImageEntry = {
  url?: string;
  content_type?: string;
  width?: number;
  height?: number;
  file_name?: string;
};

type FalResultResponse = {
  images?: FalImageEntry[];
  image?: FalImageEntry; // some models return a single object instead of an array
  prompt?: string;
  seed?: number;
};

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Aborted'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error('Aborted'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function buildFalRequestBody(req: ImageGenerationRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    prompt: req.prompt,
  };
  const count = Math.max(1, Math.min(4, req.count ?? 1));
  if (count > 1) {
    body.num_images = count;
  }
  if (req.size?.trim()) {
    body.image_size = req.size.trim();
  }
  if (req.aspectRatio?.trim()) {
    body.aspect_ratio = req.aspectRatio.trim();
  }
  if (req.outputFormat?.trim()) {
    body.output_format = req.outputFormat.trim();
  }
  // Image-to-image / edit: most Fal models accept `image_url` (single) or
  // `image_urls` (multi); xopc keeps payloads as base64 buffers, so we surface
  // them as data URIs which Fal's gateway accepts identically.
  const inputs = req.inputImages ?? [];
  if (inputs.length > 0) {
    const dataUris = inputs.map((image) => {
      const mimeType = image.mimeType?.trim() || 'image/png';
      return `data:${mimeType};base64,${Buffer.from(image.buffer).toString('base64')}`;
    });
    if (dataUris.length === 1) {
      body.image_url = dataUris[0];
    } else {
      body.image_urls = dataUris;
    }
  }
  // Caller-supplied passthrough wins over heuristic defaults.
  const overrides = (req.providerOptions as { fal?: Record<string, unknown> } | undefined)?.fal;
  if (overrides && typeof overrides === 'object') {
    Object.assign(body, overrides);
  }
  return body;
}

async function submitFalRequest(params: {
  req: ImageGenerationRequest;
  apiKey: string;
  url: string;
  headers: Record<string, string>;
  httpDefaultTimeoutMs?: number;
}): Promise<FalSubmitResponse> {
  const { req, url, headers, httpDefaultTimeoutMs } = params;
  const body = buildFalRequestBody(req);

  log.debug(
    { providerId: 'fal', url, model: req.model, phase: 'submit' },
    'Fal.ai queue submit',
  );

  const timeoutMs = pickTimeoutMsOrFallback(req.timeoutMs, httpDefaultTimeoutMs, DEFAULT_TIMEOUT_MS);
  const res = await postJsonRequest(url, {
    label: 'fal',
    timeoutMs,
    signal: req.signal,
    body,
    headers,
    ...privateNetworkPolicyToSsrfGuardOptions(),
  });

  const text = await res.text();
  let data: FalSubmitResponse;
  try {
    data = JSON.parse(text) as FalSubmitResponse;
  } catch {
    throw new Error(`Fal.ai returned non-JSON on submit: ${text.slice(0, 240)}`);
  }
  if (!data.request_id) {
    throw new Error(`Fal.ai submit missing request_id: ${text.slice(0, 240)}`);
  }
  return data;
}

async function pollFalStatus(params: {
  statusUrl: string;
  headers: Record<string, string>;
  signal?: AbortSignal;
  deadlineEpochMs: number;
}): Promise<FalStatusResponse> {
  const { statusUrl, headers, signal, deadlineEpochMs } = params;
  let interval = DEFAULT_POLL_INTERVAL_MS;
  // First check is immediate; subsequent checks back off up to MAX_POLL_INTERVAL_MS.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (Date.now() > deadlineEpochMs) {
      throw new Error('Fal.ai request timed out while waiting for completion');
    }
    const res = await fetch(statusUrl, { headers, signal });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`Fal.ai status check failed (${res.status}): ${t || res.statusText}`);
    }
    const text = await res.text();
    let data: FalStatusResponse;
    try {
      data = JSON.parse(text) as FalStatusResponse;
    } catch {
      throw new Error(`Fal.ai returned non-JSON on status: ${text.slice(0, 240)}`);
    }
    const status = (data.status || '').toUpperCase();
    if (status === 'COMPLETED') return data;
    if (status && status !== 'IN_QUEUE' && status !== 'IN_PROGRESS') {
      const errMsg = data.error || `unexpected status=${data.status ?? '<missing>'}`;
      throw new Error(`Fal.ai request failed: ${errMsg}`);
    }
    await delay(interval, signal);
    interval = Math.min(MAX_POLL_INTERVAL_MS, interval + 500);
  }
}

async function fetchFalResult(params: {
  responseUrl: string;
  headers: Record<string, string>;
  signal?: AbortSignal;
}): Promise<FalResultResponse> {
  const { responseUrl, headers, signal } = params;
  const res = await fetch(responseUrl, { headers, signal });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Fal.ai result fetch failed (${res.status}): ${t || res.statusText}`);
  }
  const text = await res.text();
  let data: FalResultResponse;
  try {
    data = JSON.parse(text) as FalResultResponse;
  } catch {
    throw new Error(`Fal.ai returned non-JSON on result: ${text.slice(0, 240)}`);
  }
  return data;
}

async function downloadFalImages(params: {
  result: FalResultResponse;
  signal?: AbortSignal;
}): Promise<Array<{ buffer: Buffer; mimeType: string; fileName: string }>> {
  const { result, signal } = params;
  const entries: FalImageEntry[] = result.images?.length
    ? result.images
    : result.image
      ? [result.image]
      : [];
  if (entries.length === 0) {
    throw new Error('Fal.ai returned no images');
  }
  const out: Array<{ buffer: Buffer; mimeType: string; fileName: string }> = [];
  let index = 0;
  for (const entry of entries) {
    if (!entry.url) continue;
    index += 1;
    const res = await fetch(entry.url, { redirect: 'follow', signal });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(
        `Fal.ai image download failed (${res.status}): ${t || res.statusText}`,
      );
    }
    const arrayBuffer = await res.arrayBuffer();
    const buf = Buffer.from(arrayBuffer);
    const mimeType =
      entry.content_type?.trim() ||
      res.headers.get('content-type')?.split(';')[0]?.trim() ||
      'image/png';
    const ext = imageFileExtensionForMimeType(mimeType);
    const fileName = entry.file_name?.trim() || `image-${index}.${ext}`;
    out.push({ buffer: buf, mimeType, fileName });
  }
  if (out.length === 0) {
    throw new Error('Fal.ai returned image entries without URLs');
  }
  return out;
}

export async function generateFalImages(params: {
  req: ImageGenerationRequest;
  apiKey: string;
}): Promise<ImageGenerationResult> {
  const { req, apiKey } = params;
  const baseUrl = resolveFalBaseUrl(req);
  const model = req.model?.trim() || FAL_DEFAULT_IMAGE_MODEL;
  const submitUrl = `${baseUrl}/${model}`;

  const httpDefaults = resolveProviderHttpRequestConfig({
    providerId: 'fal',
    cfg: req.cfg,
    fallbackTimeoutMs: DEFAULT_TIMEOUT_MS,
  });

  const headers: Record<string, string> = {
    ...httpDefaults.headers,
    authorization: `Key ${apiKey}`,
  };

  const totalDeadlineMs = req.timeoutMs ?? httpDefaults.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const deadlineEpochMs = Date.now() + totalDeadlineMs;

  const submit = await submitFalRequest({
    req,
    apiKey,
    url: submitUrl,
    headers,
    httpDefaultTimeoutMs: httpDefaults.timeoutMs,
  });

  const statusUrl =
    submit.status_url ?? `${submitUrl}/requests/${submit.request_id}/status`;
  const responseUrl =
    submit.response_url ?? `${submitUrl}/requests/${submit.request_id}`;

  log.debug(
    {
      providerId: 'fal',
      model,
      requestId: submit.request_id,
      statusUrl,
      phase: 'poll',
    },
    'Fal.ai polling for completion',
  );

  await pollFalStatus({
    statusUrl,
    headers,
    signal: req.signal,
    deadlineEpochMs,
  });

  const result = await fetchFalResult({
    responseUrl,
    headers,
    signal: req.signal,
  });
  const images = await downloadFalImages({ result, signal: req.signal });
  return { images, model };
}

export function buildFalImageGenerationProvider(): ImageGenerationProvider {
  return {
    id: 'fal',
    aliases: ['fal-ai'],
    label: 'Fal.ai',
    defaultModel: FAL_DEFAULT_IMAGE_MODEL,
    models: [...FAL_IMAGE_MODELS],
    capabilities: FAL_CAPABILITIES,
    ui: FAL_IMAGE_UI,
    isConfigured: (ctx) =>
      isProviderApiKeyConfigured({ providerId: 'fal', cfg: ctx.cfg }),
    async generateImage(req) {
      const apiKey = resolveApiKeyForProvider({ providerId: 'fal', cfg: req.cfg });
      if (!apiKey) {
        throw new Error(
          'Fal.ai API key missing (set FAL_KEY / FAL_API_KEY or providers.fal.apiKey)',
        );
      }
      return generateFalImages({ req, apiKey });
    },
  };
}
