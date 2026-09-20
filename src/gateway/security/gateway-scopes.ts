import {
  DEFAULT_BROWSER_EXTENSION_SCOPES,
  DEFAULT_MOBILE_SCOPES,
  GATEWAY_SCOPES,
  isGatewayScope,
  type GatewayScope,
} from '@xopcai/gateway-contract';

export {
  DEFAULT_BROWSER_EXTENSION_SCOPES,
  DEFAULT_MOBILE_SCOPES,
  GATEWAY_SCOPES,
  isGatewayScope,
  type GatewayScope,
};

export function parseGatewayScopes(value: string): GatewayScope[] {
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed) || !parsed.every(isGatewayScope)) {
    throw new Error('Stored device scopes are invalid');
  }
  return [...new Set(parsed)];
}

function methodScope(
  method: string,
  read: GatewayScope,
  write: GatewayScope,
): GatewayScope {
  return method === 'GET' ? read : write;
}

export function requiredGatewayScope(method: string, path: string): GatewayScope {
  if (method === 'GET' && path === '/api/mobile/privacy') return 'gateway.status';
  if (path === '/api/realtime/tickets' || path.startsWith('/api/status')) return 'gateway.status';
  if (path === '/api/device-auth/refresh' || path === '/api/devices/me') return 'device.self';
  if (path.startsWith('/api/devices/me/push')) return 'notifications.self';
  if (path.startsWith('/api/endpoint-tools')) return 'device.self';
  if (path.startsWith('/api/browser/tab-bindings')
    || path.startsWith('/api/browser/approvals')) {
    return methodScope(method, 'sessions.read', 'sessions.write');
  }
  if (method === 'GET' && path === '/api/connectors/approvals') return 'sessions.read';
  if (method === 'POST' && path === '/api/connectors/approvals/respond') return 'sessions.write';
  if (path === '/api/agent' || path.startsWith('/api/agent/')) return 'agents.run';
  if (path.startsWith('/api/agents') || path.startsWith('/api/models')) {
    return methodScope(method, 'agents.read', 'gateway.admin');
  }
  if (path.startsWith('/api/sessions') || path.startsWith('/api/side-chats')) {
    return methodScope(method, 'sessions.read', 'sessions.write');
  }
  if (path.startsWith('/api/tasks')) return methodScope(method, 'tasks.read', 'tasks.write');
  if (path.startsWith('/api/home') || path.startsWith('/api/inbox')) {
    return methodScope(method, 'tasks.read', 'tasks.write');
  }
  if (path.startsWith('/api/automations') || path.startsWith('/api/automation-runs')) {
    return methodScope(method, 'automations.read', 'automations.write');
  }
  if (path.startsWith('/api/workflows')) {
    return methodScope(method, 'automations.read', 'automations.write');
  }
  if (path === '/api/voice/selection' || path === '/api/voice/catalog/refresh') return 'voice.configure';
  if (path.startsWith('/api/voice') || path.startsWith('/api/media') || path.startsWith('/api/clarifications')) {
    return 'sessions.write';
  }
  if (path.startsWith('/api/commands') || path.startsWith('/api/skills')) {
    return methodScope(method, 'agents.read', 'gateway.admin');
  }
  if (
    path === '/api/discussions' || path.startsWith('/api/discussions/') || path === '/api/discussion-capture/settings'
    || path.startsWith('/api/workspace')
    || path.startsWith('/api/files')
    || path.startsWith('/api/projects')
    || path.startsWith('/api/notes')
    || path.startsWith('/api/shares')
  ) {
    return methodScope(method, 'workspace.read', 'workspace.write');
  }
  return 'gateway.admin';
}

export function hasGatewayScope(
  granted: readonly GatewayScope[],
  required: GatewayScope,
): boolean {
  return granted.includes('gateway.admin') || granted.includes(required);
}
