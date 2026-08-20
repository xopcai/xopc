/** Limits push-provided routes to app-owned destinations before navigation. */
export function resolveNotificationRoute(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const route = (data as { route?: unknown }).route;
  if (typeof route !== 'string' || !route.startsWith('/')) return null;
  if (
    route === '/' ||
    route === '/automation' ||
    route === '/inbox' ||
    route === '/inbox?capture=1' ||
    route === '/notes' ||
    route === '/sessions' ||
    route === '/files' ||
    /^\/chat\/[^/?#]+$/.test(route) ||
    /^\/tasks\/[^/?#]+$/.test(route) ||
    /^\/projects\/[^/?#]+$/.test(route) ||
    /^\/workflows\/runs\/[^/?#]+(?:\?(?:agentId|projectId)=[^&#]+(?:&(?:agentId|projectId)=[^&#]+)?)?$/.test(route)
  ) return route;
  return null;
}
