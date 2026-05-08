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
}

export function formatProviderHttpErrorMessage(parts: ProviderHttpErrorParts): string {
  const { label, status, detail, requestId, statusPrefix = '' } = parts;
  return (
    `${label} (${statusPrefix}${status})` +
    (detail ? `: ${detail}` : '') +
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

  constructor(parts: ProviderHttpErrorParts) {
    super(formatProviderHttpErrorMessage(parts));
    this.name = 'ProviderHttpError';
    this.status = parts.status;
    this.detail = parts.detail;
    this.requestId = parts.requestId;
    this.label = parts.label;
  }
}

export async function createProviderHttpError(
  response: Response,
  label: string,
  options?: { statusPrefix?: string },
): Promise<ProviderHttpError> {
  const detail = await extractProviderErrorDetail(response);
  const requestId = extractProviderRequestId(response);
  return new ProviderHttpError({
    label,
    status: response.status,
    detail,
    requestId,
    statusPrefix: options?.statusPrefix,
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
