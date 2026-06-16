/** Detect Telegram Bot API 401 Unauthorized (invalid/revoked token). */
export function isTelegramUnauthorizedTokenError(err: unknown): boolean {
  const text = extractErrorText(err);
  if (!text) return false;
  if (/401/.test(text) && /unauthorized/i.test(text)) return true;
  if (/401:\s*Unauthorized/i.test(text)) return true;
  return false;
}

export function formatTelegramStartupError(err: unknown): string {
  const text = extractErrorText(err);
  if (isTelegramUnauthorizedTokenError(err)) {
    return 'Telegram bot token rejected (401 Unauthorized). Check the token with BotFather or update tokenFile.';
  }
  return text || 'Unknown startup error';
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
