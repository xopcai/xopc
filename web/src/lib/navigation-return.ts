export function safeInternalReturnPath(
  value: string | null | undefined,
  fallback: string,
  allowedRoutePrefixes: readonly string[],
): string {
  const path = value?.trim();
  if (!path || !path.startsWith('/') || path.startsWith('//') || path.includes('://') || path.includes('\\')) {
    return fallback;
  }
  const routePath = path.split(/[?#]/, 1)[0] || '/';
  const allowed = allowedRoutePrefixes.some((prefix) => (
    routePath === prefix || routePath.startsWith(`${prefix}/`)
  ));
  return allowed ? path : fallback;
}

export function withReturnTo(path: string, returnTo?: string | null): string {
  const target = returnTo?.trim();
  if (!target) return path;
  const hashIndex = path.indexOf('#');
  const base = hashIndex >= 0 ? path.slice(0, hashIndex) : path;
  const hash = hashIndex >= 0 ? path.slice(hashIndex) : '';
  const separator = base.includes('?') ? '&' : '?';
  return `${base}${separator}returnTo=${encodeURIComponent(target)}${hash}`;
}
