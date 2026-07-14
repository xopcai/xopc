import { describe, expect, it } from 'vitest';
import { createGatewayCredential, gatewayCredentialAuthorization } from '../credential.js';

describe('gateway credentials', () => {
  it('normalizes non-empty values and carries their explicit kind', () => {
    expect(createGatewayCredential('password', ' secret ')).toEqual({
      kind: 'password',
      value: 'secret',
    });
  });

  it('does not produce an authorization header for unsafe values', () => {
    expect(gatewayCredentialAuthorization({ kind: 'token', value: 'line\nbreak' })).toBeUndefined();
  });
});
