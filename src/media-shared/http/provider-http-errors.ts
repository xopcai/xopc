/**
 * Provider HTTP error formatting helpers.
 *
 * Ported from openclaw/src/agents/provider-http-errors.ts (commit baseline 2026-05-08).
 *
 * DECISION (per docs/voice-rearchitecture.md §6):
 *  - Body read is hard-capped at 16 KiB to avoid memory blowups on misbehaving
 *    providers that return huge HTML 5xx pages.
 *  - Both `error.message` (OpenAI shape) and `error.detail` (DashScope shape) are
 *    normalized into a single human-readable string for logs.
 *  - Request id is taken from `x-request-id` first, then `request-id` (Alibaba uses
 *    the latter on some endpoints).
 */

const DEFAULT_BODY_READ_LIMIT_BYTES = 16 * 1024;
const DEFAULT_DETAIL_TRUNCATION_LIMIT = 220;

function asObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function trimToUndefined(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function truncateErrorDetail(detail: string, limit = DEFAULT_DETAIL_TRUNCATION_LIMIT): string {
  return detail.length <= limit ? detail : `${detail.slice(0, limit - 1)}…`;
}

export async function readResponseTextLimited(
  response: Response,
  limitBytes: number = DEFAULT_BODY_READ_LIMIT_BYTES,
): Promise<string> {
  if (limitBytes <= 0) {
    return '';
  }
  const reader = response.body?.getReader();
  if (!reader) {
    return '';
  }

  const decoder = new TextDecoder();
  let total = 0;
  let text = '';
  let reachedLimit = false;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      if (!value || value.byteLength === 0) {
        continue;
      }
      const remaining = limitBytes - total;
      if (remaining <= 0) {
        reachedLimit = true;
        break;
      }
      const chunk = value.byteLength > remaining ? value.subarray(0, remaining) : value;
      total += chunk.byteLength;
      text += decoder.decode(chunk, { stream: true });
      if (total >= limitBytes) {
        reachedLimit = true;
        break;
      }
    }
    text += decoder.decode();
  } finally {
    if (reachedLimit) {
      await reader.cancel().catch(() => {});
    }
  }

  return text;
}

/** Best-effort vendor `code` + human message from a JSON error body (image providers, failover). */
export function extractVendorErrorFields(body: string): { code?: string; message?: string } {
  if (!body) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== 'object') return {};
  const o = parsed as Record<string, unknown>;

  if (o.error && typeof o.error === 'object') {
    const e = o.error as Record<string, unknown>;
    const message = typeof e.message === 'string' ? e.message : undefined;
    const code = typeof e.code === 'string' ? e.code : typeof e.type === 'string' ? e.type : undefined;
    if (message || code) return { message, code };
  }

  if (typeof o.code === 'string' && typeof o.message === 'string') {
    return { code: o.code, message: o.message };
  }

  if (o.base_resp && typeof o.base_resp === 'object') {
    const br = o.base_resp as Record<string, unknown>;
    const sc = br.status_code;
    const sm = br.status_msg;
    if (typeof sm === 'string') {
      return {
        code: typeof sc === 'number' || typeof sc === 'string' ? String(sc) : undefined,
        message: sm,
      };
    }
  }

  if (typeof o.message === 'string') return { message: o.message };

  return {};
}

export function formatProviderErrorPayload(payload: unknown): string | undefined {
  const root = asObject(payload);
  const detailObject = asObject(root?.detail);
  const subject = asObject(root?.error) ?? detailObject ?? root;
  if (!subject) {
    return undefined;
  }
  const message =
    trimToUndefined(subject.message) ??
    trimToUndefined(subject.detail) ??
    trimToUndefined(root?.message) ??
    trimToUndefined(root?.error) ??
    trimToUndefined(root?.detail);
  const type = trimToUndefined(subject.type);
  const code = trimToUndefined(subject.code) ?? trimToUndefined(subject.status);
  const metadata = [type ? `type=${type}` : undefined, code ? `code=${code}` : undefined]
    .filter((value): value is string => Boolean(value))
    .join(', ');
  if (message && metadata) {
    return `${truncateErrorDetail(message)} [${metadata}]`;
  }
  if (message) {
    return truncateErrorDetail(message);
  }
  if (metadata) {
    return `[${metadata}]`;
  }
  return undefined;
}

export async function extractProviderErrorDetail(response: Response): Promise<string | undefined> {
  const rawBody = trimToUndefined(await readResponseTextLimited(response));
  if (!rawBody) {
    return undefined;
  }
  try {
    return formatProviderErrorPayload(JSON.parse(rawBody)) ?? truncateErrorDetail(rawBody);
  } catch {
    return truncateErrorDetail(rawBody);
  }
}

export function extractProviderRequestId(response: Response): string | undefined {
  return (
    trimToUndefined(response.headers.get('x-request-id')) ??
    trimToUndefined(response.headers.get('request-id'))
  );
}

export interface ProviderHttpErrorParts {
  label: string;
  status: number;
  detail?: string;
  requestId?: string;
  /** Prefix in front of the status code, e.g. "HTTP " for non-provider transports. */
  statusPrefix?: string;
  /** Vendor error code when JSON body could be parsed (OpenAI, DashScope, MiniMax, …). */
  code?: string;
  /** Request URL for diagnostics (image-generation assertOk path). */
  url?: string;
  /** Raw body preview for non-JSON failures (image-generation assertOk path). */
  bodyPreview?: string;
  /**
   * When set, used as {@link Error.message} verbatim instead of
   * {@link formatProviderHttpErrorMessage}.
   */
  messageOverride?: string;
}

export function formatProviderHttpErrorMessage(parts: ProviderHttpErrorParts): string {
  if (parts.messageOverride) {
    return parts.messageOverride;
  }
  const { label, status, detail, requestId, statusPrefix = '', code } = parts;
  const codeSuffix = code ? ` [code=${code}]` : '';
  return (
    `${label} (${statusPrefix}${status})` +
    (detail ? `: ${detail}` : '') +
    codeSuffix +
    (requestId ? ` [request_id=${requestId}]` : '')
  );
}

/**
 * ProviderHttpError carries the parsed status / detail / requestId so callers
 * (e.g. STT runner, TTS fallback chain) can classify failures without re-parsing.
 */
export class ProviderHttpError extends Error {
  readonly status: number;
  readonly detail?: string;
  readonly requestId?: string;
  readonly label: string;
  readonly code?: string;
  readonly url?: string;
  readonly bodyPreview?: string;

  constructor(parts: ProviderHttpErrorParts) {
    super(formatProviderHttpErrorMessage(parts));
    this.name = 'ProviderHttpError';
    this.status = parts.status;
    this.detail = parts.detail;
    this.requestId = parts.requestId;
    this.label = parts.label;
    this.code = parts.code;
    this.url = parts.url;
    this.bodyPreview = parts.bodyPreview;
  }
}

export async function createProviderHttpError(
  response: Response,
  label: string,
  options?: { statusPrefix?: string },
): Promise<ProviderHttpError> {
  const rawBody = trimToUndefined(await readResponseTextLimited(response));
  const vendor = rawBody ? extractVendorErrorFields(rawBody) : {};
  let detail: string | undefined;
  if (rawBody) {
    try {
      detail = formatProviderErrorPayload(JSON.parse(rawBody)) ?? truncateErrorDetail(rawBody);
    } catch {
      detail = truncateErrorDetail(rawBody);
    }
  }
  const requestId = extractProviderRequestId(response);
  return new ProviderHttpError({
    label,
    status: response.status,
    detail,
    requestId,
    statusPrefix: options?.statusPrefix,
    code: vendor.code,
  });
}

export async function assertOkOrThrowProviderError(response: Response, label: string): Promise<void> {
  if (response.ok) {
    return;
  }
  throw await createProviderHttpError(response, label);
}

export async function assertOkOrThrowHttpError(response: Response, label: string): Promise<void> {
  if (response.ok) {
    return;
  }
  throw await createProviderHttpError(response, label, { statusPrefix: 'HTTP ' });
}

/**
 * Throws {@link ProviderHttpError} when the response is not OK; otherwise returns
 * the response. Body is consumed on failure (do not re-read).
 *
 * Used by bundled image-generation HTTP helpers (vendor code extraction + body preview).
 */
export async function assertOk(res: Response, contextUrl?: string): Promise<Response> {
  if (res.ok) return res;
  const url = contextUrl ?? res.url;
  const bodyPreview = trimToUndefined(await readResponseTextLimited(res));
  const { code, message } = extractVendorErrorFields(bodyPreview ?? '');
  const finalMessage = `Provider HTTP ${res.status} ${res.statusText}: ${
    message || bodyPreview || '(empty body)'
  }`;
  throw new ProviderHttpError({
    label: url,
    status: res.status,
    code,
    url,
    bodyPreview,
    detail: message,
    requestId: extractProviderRequestId(res),
    messageOverride: finalMessage,
  });
}
