export const GATEWAY_SCOPES = [
  'voice.configure',
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

export const DEFAULT_MOBILE_SCOPES = [
  'voice.configure',
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
] as const satisfies readonly GatewayScope[];

export const DEFAULT_BROWSER_EXTENSION_SCOPES = [
  'gateway.status',
  'agents.read',
  'agents.run',
  'sessions.read',
  'sessions.write',
  'device.self',
] as const satisfies readonly GatewayScope[];

export function isGatewayScope(value: unknown): value is GatewayScope {
  return typeof value === 'string' && KNOWN_GATEWAY_SCOPES.has(value);
}
