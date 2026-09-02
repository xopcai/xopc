import { describe, expect, it } from 'vitest';

import { hasGatewayScope, requiredGatewayScope } from '../gateway-scopes.js';

describe('gateway scopes', () => {
  it('maps read and write operations separately', () => {
    expect(requiredGatewayScope('GET', '/api/sessions/a')).toBe('sessions.read');
    expect(requiredGatewayScope('POST', '/api/sessions/a/inputs')).toBe('sessions.write');
    expect(requiredGatewayScope('GET', '/api/tasks')).toBe('tasks.read');
    expect(requiredGatewayScope('PATCH', '/api/tasks/a')).toBe('tasks.write');
  });

  it('fails closed for unclassified routes', () => {
    expect(requiredGatewayScope('GET', '/api/new-feature')).toBe('gateway.admin');
    expect(hasGatewayScope(['gateway.status'], 'gateway.admin')).toBe(false);
  });

  it('allows gateway administrators to access every scope', () => {
    expect(hasGatewayScope(['gateway.admin'], 'sessions.write')).toBe(true);
  });
});
