import { describe, expect, it } from 'vitest';

import {
  DEFAULT_BROWSER_EXTENSION_SCOPES,
  DEFAULT_MOBILE_SCOPES,
  GATEWAY_SCOPES,
  isGatewayScope,
} from './gateway-scopes.js';

describe('gateway scopes', () => {
  it('keeps scope names unique and validates every declared scope', () => {
    expect(new Set(GATEWAY_SCOPES).size).toBe(GATEWAY_SCOPES.length);
    expect(GATEWAY_SCOPES.every(isGatewayScope)).toBe(true);
  });

  it('grants mobile voice configuration without granting admin access', () => {
    expect(DEFAULT_MOBILE_SCOPES).toContain('voice.configure');
    expect(DEFAULT_MOBILE_SCOPES).not.toContain('gateway.admin');
    expect(DEFAULT_BROWSER_EXTENSION_SCOPES).not.toContain('voice.configure');
  });
});
