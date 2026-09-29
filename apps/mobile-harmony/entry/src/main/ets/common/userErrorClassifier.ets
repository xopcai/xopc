export type XopcUserErrorKind = 'offline' | 'unavailable' | 'missing' | 'authentication' | 'conflict' |
  'rate_limited' | 'permission' | 'too_large' | 'invalid' | 'unknown';

export type XopcUserErrorContext = 'collection' | 'detail' | 'save' | 'media' | 'generic';

function normalizedError(raw: string): string {
  return raw.trim().toUpperCase();
}

export function classifyUserError(raw: string, context: XopcUserErrorContext = 'generic'): XopcUserErrorKind {
  const value = normalizedError(raw);
  if (value.includes('HTTP_401') || value.includes('DEVICE_AUTH') || value.includes('CREDENTIAL')) return 'authentication';
  if (value.includes('HTTP_403') || value.includes('PERMISSION') || value.includes('FORBIDDEN')) return 'permission';
  if (value.includes('HTTP_409') || value.includes('CONFLICT') || value.includes('REVISION') || value.includes('CHANGED')) return 'conflict';
  if (value.includes('HTTP_413') || value.includes('TOO_LARGE') || value.includes('LIMIT_EXCEEDED')) return 'too_large';
  if (value.includes('HTTP_429') || value.includes('RATE_LIMIT')) return 'rate_limited';
  if (value.includes('HTTP_404') || value.includes('NOT_FOUND') || value.includes('MISSING')) {
    return context === 'collection' ? 'unavailable' : 'missing';
  }
  if (value.includes('HTTP_5') || value.includes('SERVICE_UNAVAILABLE') || value.includes('INTERNAL_SERVER')) return 'unavailable';
  if (value.includes('OFFLINE') || value.includes('NETWORK') || value.includes('TIMEOUT') ||
    value.includes('NO_VERIFIED_ROUTE') || value.includes('CONNECTION') || value.includes('SOCKET')) return 'offline';
  if (value.includes('INVALID') || value.includes('HTTP_400') || value.includes('VALIDATION')) return 'invalid';
  return 'unknown';
}
