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
      expect(hasGatewayScope(DEFAULT_MOBILE_SCOPES, requiredGatewayScope(method, path)!)).toBe(true);
    }
    for (const [method, path] of [['GET', '/api/connectors/catalog'], ['POST', '/api/connectors/approvals'], ['DELETE', '/api/connectors/approvals/respond']]) {
      expect(requiredGatewayScope(method, path)).toBe('gateway.admin');
    }
  });
  it('maps read and write operations separately', () => {
    expect(requiredGatewayScope('GET', '/api/personal-agent')).toBe('sessions.read');
    expect(requiredGatewayScope('POST', '/api/personal-agent')).toBe('sessions.write');
    expect(requiredGatewayScope('PATCH', '/api/personal-agent/profile')).toBe('sessions.write');
    expect(requiredGatewayScope('PUT', '/api/personal-agent/avatar')).toBe('sessions.write');
    expect(requiredGatewayScope('PUT', '/api/agents/personal/avatar')).toBe('gateway.admin');
    expect(requiredGatewayScope('GET', '/api/personal-agent/activity')).toBe('tasks.read');
    expect(requiredGatewayScope('GET', '/api/personal-agent-other')).toBe('gateway.admin');
    expect(requiredGatewayScope('POST', '/api/automations/simulate')).toBe('automations.read');
    expect(requiredGatewayScope('POST', '/api/automations/draft')).toBe('automations.write');
    expect(requiredGatewayScope('POST', '/api/automations/simulate-other')).toBe('automations.write');
    expect(requiredGatewayScope('POST', '/api/notes/note/ai/edit')).toBe('workspace.read');
    expect(requiredGatewayScope('POST', '/api/notes/note/ai/edit-other')).toBe('workspace.write');
    expect(requiredGatewayScope('GET', '/api/sessions/a')).toBe('sessions.read');
    expect(requiredGatewayScope('POST', '/api/sessions/a/inputs')).toBe('sessions.write');
    expect(requiredGatewayScope('GET', '/api/tasks')).toBe('tasks.read');
    expect(requiredGatewayScope('PATCH', '/api/tasks/a')).toBe('tasks.write');
    expect(requiredGatewayScope('GET', '/api/task-runs/a')).toBe('tasks.read');
    expect(requiredGatewayScope('GET', '/api/task-runs/a/events')).toBe('tasks.read');
    expect(requiredGatewayScope('POST', '/api/task-runs/a/feedback')).toBe('tasks.write');
    expect(requiredGatewayScope('POST', '/api/task-runs/a/cancel')).toBe('tasks.write');
    expect(requiredGatewayScope('GET', '/api/task-runs-other')).toBe('gateway.admin');
  });

  it('restricts the first scene release to local administrators', () => {
    for (const path of ['/api/scenes/activations', '/api/scenes/preferences', '/api/scenes/browser/subscriptions']) {
      expect(requiredGatewayScope('GET', path)).toBe('gateway.admin');
      expect(requiredGatewayScope('POST', path)).toBe('gateway.admin');
    }
  });

  it('restricts AI usage and cost data to gateway administrators', () => {
    expect(requiredGatewayScope('GET', '/api/observability/traces')).toBe('gateway.admin');
    expect(requiredGatewayScope('PUT', '/api/observability/tracing/langfuse/credentials')).toBe('gateway.admin');
    expect(requiredGatewayScope('GET', '/api/usage/summary')).toBe('gateway.admin');
    expect(requiredGatewayScope('GET', '/api/usage/events')).toBe('gateway.admin');
    expect(hasGatewayScope(DEFAULT_MOBILE_SCOPES, 'gateway.admin')).toBe(false);
  });

  it('allows phones to inspect and correct understanding without running refresh jobs', () => {
    expect(requiredGatewayScope('GET', '/api/user-model/mobile-summary')).toBe('workspace.read');
    expect(requiredGatewayScope('GET', '/api/user-model/assertions?view=mobile')).toBe('workspace.read');
    expect(requiredGatewayScope('PATCH', '/api/user-model/assertions/a')).toBe('workspace.write');
    expect(requiredGatewayScope('PATCH', '/api/user-model/settings')).toBe('workspace.write');
    expect(requiredGatewayScope('DELETE', '/api/user-model/assertions/a')).toBe('workspace.write');
    expect(requiredGatewayScope('POST', '/api/user-model/refresh')).toBe('gateway.admin');
    expect(requiredGatewayScope('GET', '/api/user-model/refresh/status')).toBe('gateway.admin');
    expect(hasGatewayScope(DEFAULT_MOBILE_SCOPES, 'workspace.read')).toBe(true);
    expect(hasGatewayScope(DEFAULT_MOBILE_SCOPES, 'workspace.write')).toBe(true);
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
