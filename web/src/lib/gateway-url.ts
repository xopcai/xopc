/**
 * Normalize user-entered gateway base URL to an origin (scheme + host + port).
 */
export function normalizeGatewayBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed) {
    return typeof window !== 'undefined' ? window.location.origin : '';
  }
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  const u = new URL(withScheme);
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new TypeError('invalid_gateway_url');
  }
  return u.origin;
}
