import { isIPv4, isIPv6 } from 'node:net';

/**
 * SSRF-style guard for browser navigation: http(s) only, no loopback or common private ranges.
 */
export function assertBrowserUrlAllowed(raw: string): void {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error('Invalid URL');
  }

  if (url.username || url.password) {
    throw new Error('URLs with embedded credentials are not allowed');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only http and https URLs are allowed');
  }

  const host = url.hostname.toLowerCase();
  if (!host) {
    throw new Error('Missing hostname');
  }

  if (host === 'localhost' || host.endsWith('.localhost')) {
    throw new Error('Blocked: localhost');
  }

  if (isIPv4(host)) {
    if (isBlockedIPv4(host)) {
      throw new Error('Blocked: private or non-public IPv4 address');
    }
    return;
  }

  if (isIPv6(host)) {
    if (isBlockedIPv6(host)) {
      throw new Error('Blocked: private or loopback IPv6 address');
    }
    return;
  }

  // Block obvious internal TLDs (best-effort; not a full DNS SSRF defense).
  if (host.endsWith('.local') || host.endsWith('.internal')) {
    throw new Error('Blocked: internal hostname');
  }
}

function isBlockedIPv4(host: string): boolean {
  const parts = host.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true;
  }
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
  return false;
}

function isBlockedIPv6(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === '::1') return true;
  if (h.startsWith('fe80:')) return true; // link-local
  if (h.startsWith('fc') || h.startsWith('fd')) return true; // ULA fc00::/7
  return false;
}
