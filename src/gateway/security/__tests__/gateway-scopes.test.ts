import { describe, expect, it } from 'vitest';

import {
  DEFAULT_BROWSER_EXTENSION_SCOPES,
  DEFAULT_MOBILE_SCOPES,
  hasGatewayScope,
  requiredGatewayScope,
} from '../gateway-scopes.js';

describe('gateway scopes', () => {
  it('requires voice configuration permission without granting general administration', () => {
    expect(requiredGatewayScope('PUT', '/api/voice/selection')).toBe('voice.configure');
    expect(hasGatewayScope(DEFAULT_MOBILE_SCOPES, 'voice.configure')).toBe(true);
    expect(hasGatewayScope(DEFAULT_MOBILE_SCOPES, 'gateway.admin')).toBe(false);
    expect(hasGatewayScope(DEFAULT_BROWSER_EXTENSION_SCOPES, 'voice.configure')).toBe(false);
  });
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

  it('restricts the first scene release to local administrators', () => {
    for (const path of ['/api/scenes/activations', '/api/scenes/preferences', '/api/scenes/browser/subscriptions']) {
      expect(requiredGatewayScope('GET', path)).toBe('gateway.admin');
      expect(requiredGatewayScope('POST', path)).toBe('gateway.admin');
    }
  });

  it('fails closed for unclassified routes', () => {
    expect(requiredGatewayScope('GET', '/api/new-feature')).toBe('gateway.admin');
    expect(hasGatewayScope(['gateway.status'], 'gateway.admin')).toBe(false);
  });

  it('allows gateway administrators to access every scope', () => {
    expect(hasGatewayScope(['gateway.admin'], 'sessions.write')).toBe(true);
  });

  it('limits browser extensions to chat and device capabilities', () => {
    expect(DEFAULT_BROWSER_EXTENSION_SCOPES).toEqual([
      'gateway.status',
      'agents.read',
      'agents.run',
      'sessions.read',
      'sessions.write',
      'device.self',
    ]);
    expect(hasGatewayScope(DEFAULT_BROWSER_EXTENSION_SCOPES, 'workspace.read')).toBe(false);
    expect(hasGatewayScope(DEFAULT_BROWSER_EXTENSION_SCOPES, 'gateway.admin')).toBe(false);
  });
});
