import { describe, expect, it } from 'vitest';

import { classifyUserFacingError, userFacingErrorMessage } from '../user-facing-error';

const copy = {
  offline: 'offline', unavailable: 'unavailable', collectionUnavailable: 'collection', missing: 'missing',
  authentication: 'authentication', conflict: 'conflict', rateLimited: 'rate', permission: 'permission',
  tooLarge: 'large', invalid: 'invalid', unknown: 'unknown',
};

describe('user-facing mobile errors', () => {
  it('classifies HTTP and connectivity failures without relying on backend prose', () => {
    expect(classifyUserFacingError(new Error('404 Not Found'))).toBe('missing');
    expect(classifyUserFacingError(new Error('HTTP_503'))).toBe('unavailable');
    expect(classifyUserFacingError(new Error('Could not reach gateway'))).toBe('offline');
    expect(classifyUserFacingError(new Error('HTTP_409'))).toBe('conflict');
    expect(classifyUserFacingError(new Error('HTTP_413'))).toBe('tooLarge');
    expect(classifyUserFacingError(new Error('HTTP_429'))).toBe('rateLimited');
  });

  it('uses page context for 404 collection failures', () => {
    expect(userFacingErrorMessage(new Error('404 Not Found'), copy, 'collection')).toBe('collection');
    expect(userFacingErrorMessage(new Error('404 Not Found'), copy, 'detail')).toBe('missing');
  });

  it('falls back to safe copy instead of rendering diagnostics', () => {
    expect(userFacingErrorMessage(new Error('SQLITE_CORRUPT: /private/path'), copy)).toBe('unknown');
  });
});
