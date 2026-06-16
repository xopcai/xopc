const RECOVERABLE_NETWORK_RE =
  /ETIMEDOUT|ENETUNREACH|EHOSTUNREACH|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|socket hang up|fetch failed|network/i;

export function isRecoverableTelegramNetworkError(err: unknown): boolean {
  const text = extractErrorText(err);
  return RECOVERABLE_NETWORK_RE.test(text);
}

export function isTelegramClientRejection(err: unknown): boolean {
  const text = extractErrorText(err);
  return /400:|403:|429:|Bad Request|Forbidden|Too Many Requests/i.test(text);
}

function extractErrorText(err: unknown): string {
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object' && 'description' in err) {
    const d = (err as { description?: unknown }).description;
    return typeof d === 'string' ? d : '';
  }
  return String(err);
}
