/**
 * Error classification for Telegram draft streaming (aligned with OpenClaw network-errors).
 */

export function extractTelegramErrorText(err: unknown): string {
  return typeof err === 'string'
    ? err
    : err instanceof Error
      ? err.message
      : typeof err === 'object' && err && 'description' in err
        ? typeof (err as { description?: unknown }).description === 'string'
          ? (err as { description: string }).description
          : ''
        : '';
}

export function shouldFallbackFromDraftTransport(err: unknown): boolean {
  const text = extractTelegramErrorText(err);
  if (!/sendMessageDraft/i.test(text)) {
    return false;
  }
  return (
    /(unknown method|method .*not (found|available|supported)|unsupported)/i.test(text) ||
    /(can't be used|can be used only)/i.test(text)
  );
}

const THREAD_NOT_FOUND_RE =
  /400:\s*Bad Request:\s*message thread not found/i;

export function isTelegramThreadNotFoundError(err: unknown): boolean {
  return THREAD_NOT_FOUND_RE.test(extractTelegramErrorText(err));
}

export function isSafeToRetrySendError(err: unknown): boolean {
  const text = extractTelegramErrorText(err);
  return /ECONNRESET|ETIMEDOUT|ENOTFOUND|ENETUNREACH|EAI_AGAIN|socket hang up/i.test(text);
}

export function isTelegramClientRejection(err: unknown): boolean {
  const text = extractTelegramErrorText(err);
  return /400:\s*Bad Request|403:|404:/i.test(text);
}
