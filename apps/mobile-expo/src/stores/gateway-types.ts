export const GATEWAY_SCOPES = [
  'gateway.status', 'agents.read', 'agents.run', 'sessions.read', 'sessions.write',
  'workspace.read', 'workspace.write', 'tasks.read', 'tasks.write',
  'automations.read', 'automations.write', 'notifications.self', 'device.self',
  'gateway.admin',
] as const;

export type GatewayScope = (typeof GATEWAY_SCOPES)[number];
export type GatewayRouteKind = 'xopc-secure-link' | 'tailscale' | 'custom-https';
export type GatewayRoute = { id: string; kind: GatewayRouteKind; url: string };
export type GatewayProfile = {
  gatewayId: string;
  name: string;
  gatewayPublicKey: string;
  deviceId: string;
  scopes: GatewayScope[];
  routes: GatewayRoute[];
  activeRouteId: string;
  updatedAt: number;
};

const scopeSet = new Set<string>(GATEWAY_SCOPES);
const routeKindSet = new Set<string>(['xopc-secure-link', 'tailscale', 'custom-https']);

export function normalizeSecureGatewayUrl(raw: string): string {
  const parsed = new URL(raw.trim());
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    throw new Error('Mobile gateway routes must use HTTPS');
  }
  if (parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error('Mobile gateway routes must be HTTPS origins');
  }
  return parsed.origin;
}

function parseRoute(value: unknown): GatewayRoute | null {
  if (typeof value !== 'object' || value === null) return null;
  const route = value as Record<string, unknown>;
  if (
    typeof route.id !== 'string' || !route.id ||
    typeof route.kind !== 'string' || !routeKindSet.has(route.kind) ||
    typeof route.url !== 'string'
  ) return null;
  try {
    return { id: route.id, kind: route.kind as GatewayRouteKind, url: normalizeSecureGatewayUrl(route.url) };
  } catch {
    return null;
  }
}

export function parseGatewayProfile(value: unknown): GatewayProfile | null {
  if (typeof value !== 'object' || value === null) return null;
  const profile = value as Record<string, unknown>;
  if (
    typeof profile.gatewayId !== 'string' || !profile.gatewayId ||
    typeof profile.name !== 'string' || !profile.name.trim() ||
    typeof profile.gatewayPublicKey !== 'string' || !profile.gatewayPublicKey ||
    typeof profile.deviceId !== 'string' || !profile.deviceId ||
    !Array.isArray(profile.scopes) || !profile.scopes.every((scope) => typeof scope === 'string' && scopeSet.has(scope)) ||
    !Array.isArray(profile.routes) || typeof profile.activeRouteId !== 'string' || !profile.activeRouteId ||
    typeof profile.updatedAt !== 'number' || !Number.isFinite(profile.updatedAt)
  ) return null;
  const routes = profile.routes.map(parseRoute);
  if (routes.length === 0 || routes.some((route) => route === null)) return null;
  const validRoutes = routes as GatewayRoute[];
  if (!validRoutes.some((route) => route.id === profile.activeRouteId)) return null;
  return {
    gatewayId: profile.gatewayId,
    name: profile.name.trim(),
    gatewayPublicKey: profile.gatewayPublicKey,
    deviceId: profile.deviceId,
    scopes: [...new Set(profile.scopes)] as GatewayScope[],
    routes: validRoutes,
    activeRouteId: profile.activeRouteId,
    updatedAt: profile.updatedAt,
  };
}

export function activeGatewayRoute(profile: GatewayProfile | null): GatewayRoute | null {
  if (!profile) return null;
  return profile.routes.find((route) => route.id === profile.activeRouteId) ?? null;
}

export function gatewayProfileHost(profile: GatewayProfile): string {
  return new URL(activeGatewayRoute(profile)?.url ?? profile.routes[0].url).hostname;
}
