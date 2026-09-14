import { describe, expect, it } from 'vitest';

import { tunnelApiErrorCode, tunnelApiRequiresAuthorization } from './tunnel-api';

describe('tunnelApiErrorCode', () => {
  it('reads a structured Gateway error code', () => {
    expect(tunnelApiErrorCode({
      body: {
        error: {
          code: 'tunnel_key_limit_reached',
          message: 'Maximum 10 tunnel keys allowed',
        },
      },
    })).toBe('tunnel_key_limit_reached');
  });

  it('ignores legacy and malformed error shapes', () => {
    expect(tunnelApiErrorCode({ body: { error: 'failed' } })).toBeUndefined();
    expect(tunnelApiErrorCode(null)).toBeUndefined();
  });

  it('only requests authorization for credential failures', () => {
    const error = (code: string) => ({ body: { error: { code } } });
    expect(tunnelApiRequiresAuthorization(error('tunnel_oauth_required'))).toBe(true);
    expect(tunnelApiRequiresAuthorization(error('invalid_token'))).toBe(true);
    expect(tunnelApiRequiresAuthorization(error('insufficient_scope'))).toBe(true);
    expect(tunnelApiRequiresAuthorization(error('tunnel_key_limit_reached'))).toBe(false);
  });
});
