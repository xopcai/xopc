/**
 * Uniform Response → Error mapper for provider HTTP calls.
 *
 * Reads up to 8KB of the response body for context (truncates the rest) and
 * extracts a `code` from common JSON error shapes:
 *   { error: { message, code } }     // OpenAI / many vendors
 *   { error: { message, type } }
 *   { code, message }                // DashScope
 *   { request_id, base_resp: { status_code, status_msg } }  // MiniMax
 */

const MAX_BODY_PREVIEW_BYTES = 8 * 1024;

export class ProviderHttpError extends Error {
  readonly status: number;
  readonly statusText: string;
  readonly url: string;
  readonly code?: string;
  readonly bodyPreview: string;

  constructor(params: {
    status: number;
    statusText: string;
    url: string;
    code?: string;
    bodyPreview: string;
    message: string;
  }) {
    super(params.message);
    this.name = 'ProviderHttpError';
    this.status = params.status;
    this.statusText = params.statusText;
    this.url = params.url;
    this.code = params.code;
    this.bodyPreview = params.bodyPreview;
  }
}

/**
 * Throws {@link ProviderHttpError} if `res.ok` is false.
 * Otherwise returns the original Response.
 *
 * The body is consumed on failure; do not re-read it.
 */
export async function assertOk(res: Response, contextUrl?: string): Promise<Response> {
  if (res.ok) return res;
  const url = contextUrl ?? res.url;
  const bodyPreview = await readBodyPreview(res);
  const { code, message } = extractErrorFields(bodyPreview);
  const finalMessage = `Provider HTTP ${res.status} ${res.statusText}: ${
    message || bodyPreview || '(empty body)'
  }`;
  throw new ProviderHttpError({
    status: res.status,
    statusText: res.statusText,
    url,
    code,
    bodyPreview,
    message: finalMessage,
  });
}

async function readBodyPreview(res: Response): Promise<string> {
  try {
    const text = await res.text();
    if (text.length <= MAX_BODY_PREVIEW_BYTES) return text;
    return `${text.slice(0, MAX_BODY_PREVIEW_BYTES)}…(truncated)`;
  } catch {
    return '';
  }
}

function extractErrorFields(body: string): { code?: string; message?: string } {
  if (!body) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== 'object') return {};
  const o = parsed as Record<string, unknown>;

  // OpenAI-style: { error: { message, code } }
  if (o.error && typeof o.error === 'object') {
    const e = o.error as Record<string, unknown>;
    const message = typeof e.message === 'string' ? e.message : undefined;
    const code = typeof e.code === 'string' ? e.code : typeof e.type === 'string' ? e.type : undefined;
    if (message || code) return { message, code };
  }

  // DashScope-style: { code, message }
  if (typeof o.code === 'string' && typeof o.message === 'string') {
    return { code: o.code, message: o.message };
  }

  // MiniMax-style: { base_resp: { status_code, status_msg } }
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

  // Plain { message }
  if (typeof o.message === 'string') return { message: o.message };

  return {};
}
