/**
 * Telegram Error Utilities
 */

// Regex to detect Telegram HTML parse errors
const TELEGRAM_PARSE_ERR_RE = /can't parse entities|parse entities|find end of the entity|Unmatched end tag/i;

/**
 * Check if error is a Telegram HTML parse error
 */
export function isTelegramHtmlParseError(err: unknown): boolean {
  if (!(err instanceof Error)) {
    return false;
  }
  return TELEGRAM_PARSE_ERR_RE.test(err.message);
}
