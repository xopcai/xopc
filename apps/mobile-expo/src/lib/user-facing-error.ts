import type { MessageBundle } from '../i18n/messages';

export type UserErrorKind = 'offline' | 'unavailable' | 'missing' | 'authentication' | 'conflict' |
  'rateLimited' | 'permission' | 'tooLarge' | 'invalid' | 'unknown';
export type UserErrorContext = 'collection' | 'detail' | 'save' | 'media' | 'generic';
export type UserErrorCopy = MessageBundle['mobileExperience']['errors'];

function diagnostic(error: unknown): string {
  if (error instanceof Error) return error.message.trim().toUpperCase();
  return String(error ?? '').trim().toUpperCase();
}

export function classifyUserFacingError(error: unknown, context: UserErrorContext = 'generic'): UserErrorKind {
  const value = diagnostic(error);
  if (value.includes('HTTP_401') || value.match(/(^|\D)401(\D|$)/) || value.includes('DEVICE_AUTH') || value.includes('CREDENTIAL')) return 'authentication';
  if (value.includes('HTTP_403') || value.match(/(^|\D)403(\D|$)/) || value.includes('PERMISSION') || value.includes('FORBIDDEN')) return 'permission';
  if (value.includes('HTTP_409') || value.match(/(^|\D)409(\D|$)/) || value.includes('CONFLICT') || value.includes('REVISION') || value.includes('CHANGED')) return 'conflict';
  if (value.includes('HTTP_413') || value.match(/(^|\D)413(\D|$)/) || value.includes('TOO_LARGE') || value.includes('LIMIT_EXCEEDED')) return 'tooLarge';
  if (value.includes('HTTP_429') || value.match(/(^|\D)429(\D|$)/) || value.includes('RATE_LIMIT')) return 'rateLimited';
  if (value.includes('HTTP_404') || value.match(/(^|\D)404(\D|$)/) || value.includes('NOT_FOUND') || value.includes('MISSING')) {
    return context === 'collection' ? 'unavailable' : 'missing';
  }
  if (value.includes('HTTP_5') || value.match(/(^|\D)5\d\d(\D|$)/) || value.includes('SERVICE_UNAVAILABLE') || value.includes('INTERNAL_SERVER')) return 'unavailable';
  if (value.includes('OFFLINE') || value.includes('NETWORK') || value.includes('TIMEOUT') || value.includes('NO-ROUTE') ||
    value.includes('NO_ROUTE') || value.includes('CONNECTION') || value.includes('SOCKET') || value.includes('COULD NOT REACH')) return 'offline';
  if (value.includes('INVALID') || value.includes('HTTP_400') || value.match(/(^|\D)400(\D|$)/) || value.includes('VALIDATION')) return 'invalid';
  return 'unknown';
}

export function userFacingErrorMessage(error: unknown, copy: UserErrorCopy, context: UserErrorContext = 'generic'): string {
  const kind = classifyUserFacingError(error, context);
  if (kind === 'unavailable' && context === 'collection') return copy.collectionUnavailable;
  return copy[kind];
}
