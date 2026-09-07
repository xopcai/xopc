import { describe, expect, it } from 'vitest';

import { DEFAULT_MOBILE_SCOPES, hasGatewayScope, requiredGatewayScope } from '../gateway-scopes.js';

describe('gateway scopes', () => {
  it('allows paired phones to read and respond to session confirmations', () => {
    expect(requiredGatewayScope('GET', '/api/connectors/approvals')).toBe('sessions.read');
    expect(requiredGatewayScope('POST', '/api/connectors/approvals/respond')).toBe('sessions.write');
    for (const [method, path] of [['GET', '/api/connectors/approvals'], ['POST', '/api/connectors/approvals/respond']]) {
      expect(hasGatewayScope(DEFAULT_MOBILE_SCOPES, requiredGatewayScope(method, path))).toBe(true);
    }
    for (const [method, path] of [['GET', '/api/connectors/catalog'], ['POST', '/api/connectors/approvals'], ['DELETE', '/api/connectors/approvals/respond']]) {
      expect(requiredGatewayScope(method, path)).toBe('gateway.admin');
    }
  });
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
