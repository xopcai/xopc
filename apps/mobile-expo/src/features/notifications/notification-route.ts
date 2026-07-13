/** Limits push-provided routes to app-owned destinations before navigation. */
export function resolveNotificationRoute(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const route = (data as { route?: unknown }).route;
  if (typeof route !== 'string' || !route.startsWith('/')) return null;
  if (route === '/' || route === '/automation' || route.startsWith('/chat/')) return route;
  return null;
}
