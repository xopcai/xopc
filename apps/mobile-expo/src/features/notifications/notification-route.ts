/** Limits push-provided routes to app-owned destinations before navigation. */
export function resolveNotificationRoute(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const payload = data as { route?: unknown; runId?: unknown };
  const route = payload.route;
  if (typeof route !== 'string' || !route.startsWith('/')) return null;
  if (route === '/automation' && typeof payload.runId === 'string' && payload.runId.trim()) {
    return `/automation/runs/${encodeURIComponent(payload.runId.trim())}`;
  }
  if (
    route === '/' ||
    route === '/automation' ||
    route === '/inbox' ||
    /^\/inbox\?(?:capture=1|item=[^&#]+)$/.test(route) ||
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
