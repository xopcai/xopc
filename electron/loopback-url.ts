/** True for loopback gateway console URLs (embedded Electron loads the SPA here). */
export function isEmbeddedGatewayLoopbackUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      return false;
    }
    const h = u.hostname.toLowerCase();
    if (h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1') {
      return true;
    }
    return /^127\.\d+\.\d+\.\d+$/.test(h);
  } catch {
    return false;
  }
}

/** A published site served by the embedded gateway's `/site/:token/` fallback. */
export function isEmbeddedGatewaySiteShareUrl(raw: string): boolean {
  if (!isEmbeddedGatewayLoopbackUrl(raw)) return false;
  try {
    return /^\/site\/[^/]+(?:\/|$)/.test(new URL(raw).pathname);
  } catch {
    return false;
  }
}
