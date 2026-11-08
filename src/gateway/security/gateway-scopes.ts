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

export function requiredGatewayScope(method: string, path: string): GatewayScope | undefined {
  if (/^\/api\/local-app-capabilities\/[^/]+(?:\/[^/]+\/invocations|\/runs\/[^/]+\/events)?$/.test(path)) return undefined;
  // Authentication admits this surface; the dispatcher checks each capability's scopes.
  if (path === '/api/capabilities/operations' || path.startsWith('/api/capabilities/operations/')) return undefined;
  if (method === 'GET' && path === '/api/desktop-host/compatibility') return 'device.self';
  if (method === 'GET' && (path === '/api/desktop-host/operations' || /^\/api\/desktop-host\/operations\/[^/]+$/.test(path)) || method === 'POST' && /^\/api\/desktop-host\/operations\/[^/]+\/review$/.test(path)) return 'device.self';
  if (method === 'GET' && path === '/api/desktop-host/status') return 'device.self';
  if (['GET', 'POST', 'DELETE'].includes(method) && path === '/api/desktop-host/execution') return 'device.self';
  if (method === 'DELETE' && ['/api/desktop-host/observation', '/api/desktop-host/screen'].includes(path)) return 'device.self';
  if (method === 'GET' && path === '/api/mobile/privacy') return 'gateway.status';
  if (path === '/api/realtime/tickets' || path.startsWith('/api/status')) return 'gateway.status';
  if (path === '/api/device-auth/refresh' || path === '/api/devices/me') return 'device.self';
  if (path.startsWith('/api/devices/me/push')) return 'notifications.self';
  if (method === 'POST' && path === '/api/endpoint-tools/devices/revoke') return 'gateway.admin';
  if (/^\/api\/phone\/conversations\/[^/]+\/summary$/.test(path) && method === 'GET') return 'sessions.read';
  if (/^\/api\/phone\/conversations\/[^/]+$/.test(path) && method === 'GET') return 'phone.view';
  if (/^\/api\/phone\/conversations\/[^/]+\/[^/]+\/frame$/.test(path) && method === 'GET') return 'phone.view';
  if (/^\/api\/phone\/conversations\/[^/]+\/[^/]+\/video-ticket$/.test(path) && method === 'POST') return 'phone.view';
  if (/^\/api\/phone\/conversations\/[^/]+\/[^/]+\/control$/.test(path) && method === 'POST') return 'phone.control';
  if (path === '/api/endpoint-tools/hosts/enrollment' || path === '/api/endpoint-tools/providers/admission' || path.startsWith('/api/endpoint-tools/provider-operations/')) return 'gateway.admin';
  if (path.startsWith('/api/endpoint-tools')) return 'device.self';
  if (path === '/api/user-context/environment' || path.startsWith('/api/user-context/environment/')) return 'device.self';
  if (path === '/api/personal-agent/activity') return 'tasks.read';
  if (path === '/api/personal-agent' || path.startsWith('/api/personal-agent/')) {
    return methodScope(method, 'sessions.read', 'sessions.write');
  }
  if (path.startsWith('/api/browser/tab-bindings')) {
    return methodScope(method, 'sessions.read', 'sessions.write');
  }
  if (method === 'GET' && path === '/api/connectors/approvals') return 'sessions.read';
  if (method === 'POST' && path === '/api/connectors/approvals/respond') return 'sessions.write';
  if (path === '/api/agent' || path.startsWith('/api/agent/')) return 'agents.run';
  if (path === '/api/observability' || path.startsWith('/api/observability/')) return 'gateway.admin';
  if (path.startsWith('/api/usage')) return 'gateway.admin';
  if (path.startsWith('/api/agents') || path.startsWith('/api/models')) {
    return methodScope(method, 'agents.read', 'gateway.admin');
  }
  if (path.startsWith('/api/sessions') || path.startsWith('/api/side-chats')) {
    return methodScope(method, 'sessions.read', 'sessions.write');
  }
  if (path.startsWith('/api/tasks')) return methodScope(method, 'tasks.read', 'tasks.write');
  if (path === '/api/task-runs' || path.startsWith('/api/task-runs/')) return methodScope(method, 'tasks.read', 'tasks.write');
  if (path.startsWith('/api/home') || path.startsWith('/api/inbox')) {
    return methodScope(method, 'tasks.read', 'tasks.write');
  }
  if (method === 'POST' && path === '/api/automations/simulate') return 'automations.read';
  if (method === 'POST' && /^\/api\/notes\/[^/]+\/ai\/edit$/.test(path)) return 'workspace.read';
  if (path.startsWith('/api/automations') || path.startsWith('/api/automation-runs')) {
    return methodScope(method, 'automations.read', 'automations.write');
  }

  if (path === '/api/voice/selection' || path === '/api/voice/catalog/refresh' || path === '/api/voice/boson' || path === '/api/voice/boson/reveal-api-key') return 'voice.configure';
  if (path.startsWith('/api/voice') || path.startsWith('/api/media') || path.startsWith('/api/clarifications')) {
    return 'sessions.write';
  }
  if (path.startsWith('/api/commands') || path.startsWith('/api/skills')) {
    return methodScope(method, 'agents.read', 'gateway.admin');
  }
  if (path === '/api/user-model/refresh' || path.startsWith('/api/user-model/refresh/')) return 'gateway.admin';
  if (path === '/api/user-model' || path.startsWith('/api/user-model/')) {
    return methodScope(method, 'workspace.read', 'workspace.write');
  }
  if (path === '/api/knowledge-memory' || path.startsWith('/api/knowledge-memory/')) {
    return methodScope(method, 'workspace.read', 'workspace.write');
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
