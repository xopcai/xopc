import { describe, expect, it } from 'vitest';

import { classifyUserError } from '../entry/src/main/ets/common/userErrorClassifier.ets';

describe('user-facing error classification', () => {
  it('covers transport status and stable domain codes', () => {
    expect(classifyUserError('HTTP_401')).toBe('authentication');
    expect(classifyUserError('HTTP_403')).toBe('permission');
    expect(classifyUserError('HTTP_409')).toBe('conflict');
    expect(classifyUserError('HTTP_413')).toBe('too_large');
    expect(classifyUserError('HTTP_429')).toBe('rate_limited');
    expect(classifyUserError('HTTP_503')).toBe('unavailable');
    expect(classifyUserError('NETWORK_TIMEOUT')).toBe('offline');
    expect(classifyUserError('INVALID_API_PATH')).toBe('invalid');
  });

  it('uses navigation context to distinguish missing content from an unavailable collection', () => {
    expect(classifyUserError('HTTP_404', 'detail')).toBe('missing');
    expect(classifyUserError('HTTP_404', 'collection')).toBe('unavailable');
  });

  it('never exposes an unrecognized diagnostic as a category', () => {
    expect(classifyUserError('SQLITE_CORRUPT: internal details')).toBe('unknown');
  });
});
