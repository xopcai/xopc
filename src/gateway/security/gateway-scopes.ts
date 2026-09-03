export const GATEWAY_SCOPES = [
  'gateway.status',
  'agents.read',
  'agents.run',
  'sessions.read',
  'sessions.write',
  'workspace.read',
  'workspace.write',
  'tasks.read',
  'tasks.write',
  'automations.read',
  'automations.write',
  'notifications.self',
  'device.self',
  'gateway.admin',
] as const;

export type GatewayScope = typeof GATEWAY_SCOPES[number];

const KNOWN_GATEWAY_SCOPES = new Set<string>(GATEWAY_SCOPES);

export const DEFAULT_MOBILE_SCOPES: readonly GatewayScope[] = [
  'gateway.status',
  'agents.read',
  'agents.run',
  'sessions.read',
  'sessions.write',
  'workspace.read',
  'workspace.write',
  'tasks.read',
  'tasks.write',
  'automations.read',
  'automations.write',
  'notifications.self',
  'device.self',
];

export function isGatewayScope(value: unknown): value is GatewayScope {
  return typeof value === 'string' && KNOWN_GATEWAY_SCOPES.has(value);
}

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
  if (path.startsWith('/api/voice') || path.startsWith('/api/media') || path.startsWith('/api/clarify')) {
    return 'sessions.write';
  }
  if (path.startsWith('/api/commands') || path.startsWith('/api/skills')) {
    return methodScope(method, 'agents.read', 'gateway.admin');
  }
  if (
    path.startsWith('/api/workspace')
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
