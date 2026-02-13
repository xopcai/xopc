export type FailoverReason =
  | 'auth'
  | 'format'
  | 'rate_limit'
  | 'billing'
  | 'timeout'
  | 'unknown';

export function isRateLimitErrorMessage(raw: string): boolean {
  return raw.toLowerCase().includes('rate limit') || /429/i.test(raw);
}

export function isTimeoutErrorMessage(raw: string): boolean {
  return raw.toLowerCase().includes('timeout') || raw.toLowerCase().includes('timed out');
}

export function isBillingErrorMessage(raw: string): boolean {
  const lower = raw.toLowerCase();
  return lower.includes('402') || lower.includes('billing') || lower.includes('insufficient credit');
}

export function isAuthErrorMessage(raw: string): boolean {
  const lower = raw.toLowerCase();
  return lower.includes('401') || lower.includes('403') || lower.includes('unauthorized') || lower.includes('invalid api key');
}

export function isFormatErrorMessage(raw: string): boolean {
  return raw.toLowerCase().includes('invalid request format') || raw.toLowerCase().includes('tool_use.id');
}

function getStatusCode(err: unknown): number | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const status = (err as { status?: unknown }).status ?? (err as { statusCode?: unknown }).statusCode;
  if (typeof status === 'number') return status;
  if (typeof status === 'string' && /^\d+$/.test(status)) return Number(status);
  return undefined;
}

function getErrorCode(err: unknown): string | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const code = (err as { code?: unknown }).code;
  if (typeof code === 'string') return code.trim() || undefined;
  return undefined;
}

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object') {
    const msg = (err as { message?: unknown }).message;
    if (typeof msg === 'string') return msg;
  }
  return String(err);
}

export function classifyFailoverReason(err: unknown): FailoverReason {
  const status = getStatusCode(err);
  if (status === 402) return 'billing';
  if (status === 429) return 'rate_limit';
  if (status === 401 || status === 403) return 'auth';
  if (status === 408) return 'timeout';
  if (status === 400) return 'format';

  const code = (getErrorCode(err) ?? '').toUpperCase();
  if (['ETIMEDOUT', 'ECONNRESET'].includes(code)) return 'timeout';

  const message = getErrorMessage(err);
  if (!message) return 'unknown';

  if (isRateLimitErrorMessage(message)) return 'rate_limit';
  if (isBillingErrorMessage(message)) return 'billing';
  if (isTimeoutErrorMessage(message)) return 'timeout';
  if (isAuthErrorMessage(message)) return 'auth';
  if (isFormatErrorMessage(message)) return 'format';

  return 'unknown';
}
