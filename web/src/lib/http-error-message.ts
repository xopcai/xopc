import { messages } from '@/i18n/messages';
import type { StoredLanguage } from '@/lib/storage';
import { useLocaleStore } from '@/stores/locale-store';

function currentLanguage(): StoredLanguage {
  return useLocaleStore.getState().language;
}

/** Treat boilerplate server text as empty so we show localized copy instead. */
function isRedundantServerMessage(message: string, status: number, statusText: string): boolean {
  const t = message.trim().toLowerCase();
  if (!t) return true;
  if (t === `http ${status}`) return true;
  if (statusText && t === statusText.trim().toLowerCase()) return true;
  if (status === 429 && (
    t === 'rate_limited' ||
    t === 'too many requests' ||
    t === 'too many authentication attempts'
  )) return true;
  if (status === 500 && t === 'internal server error') return true;
  return false;
}

/**
 * Prefer a concrete API `error.message` when it is not generic; otherwise map status to i18n.
 */
export function formatApiHttpError(
  status: number,
  statusText: string,
  serverMessage?: string | null,
): string {
  const raw = serverMessage?.trim() ?? '';
  if (raw && !isRedundantServerMessage(raw, status, statusText)) {
    return raw;
  }

  const L = messages(currentLanguage()).api;
  if (status >= 500) {
    if (status === 502) return L.errorBadGateway;
    if (status === 503) return L.errorServiceUnavailable;
    if (status === 504) return L.errorGatewayTimeout;
    if (status === 500) return L.errorInternal;
    return L.errorServer.replace('{{status}}', String(status));
  }
  if (status === 404) return L.errorNotFound;
  if (status === 403) return L.errorForbidden;
  if (status === 429) return L.errorRateLimited;
  return L.errorRequest.replace('{{status}}', String(status));
}
