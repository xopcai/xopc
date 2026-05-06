export function getBaseUrl(): string {
  return window.location.origin;
}

export function apiUrl(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${getBaseUrl()}${p}`;
}

/** Mobile apps register `xopc://` and read `baseUrl` + `token` from this deep link after scan. */
export function buildMobileGatewayPairDeepLink(params: { baseUrl: string; gatewayToken: string }): string {
  const origin = params.baseUrl.trim().replace(/\/+$/, '');
  const u = new URL('xopc://gateway/mobile-connect');
  u.searchParams.set('baseUrl', origin);
  u.searchParams.set('token', params.gatewayToken);
  return u.toString();
}

export function isLoopbackHttpOrigin(origin: string): boolean {
  try {
    const u = new URL(origin.trim());
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      return false;
    }
    const h = u.hostname.toLowerCase();
    return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1';
  } catch {
    return false;
  }
}
