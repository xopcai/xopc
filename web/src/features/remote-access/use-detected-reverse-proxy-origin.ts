import { useMemo } from 'react';

function isPrivateIpV4(host: string): boolean {
  const parts = host.split('.').map((p) => Number.parseInt(p, 10));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return false;
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT (mesh / tailnet)
  return false;
}

/**
 * Detect a candidate reverse-proxy URL by inspecting `window.location.origin`.
 *
 * If the user is currently accessing the gateway console through a reverse
 * proxy (e.g. https://gateway.example.com), the origin itself is a strong
 * signal that the URL is publicly reachable. We use it to pre-fill the
 * reverse-proxy form, with an opt-in to persist
 * the value as `gateway.publicUrl`.
 *
 * Returns null for cases that are NOT a reverse-proxy origin:
 *  - loopback / localhost (user is on the gateway machine itself)
 *  - RFC1918 / CGNAT IPs (covered by the LAN tab already)
 *  - mDNS `.local` hostnames (LAN tab)
 *  - non-http(s) schemes
 */
export function useDetectedReverseProxyOrigin(): string | null {
  return useMemo(() => {
    if (typeof window === 'undefined') return null;
    const { protocol, hostname, origin } = window.location;
    if (protocol !== 'https:' && protocol !== 'http:') return null;
    const host = hostname.toLowerCase();
    if (!host) return null;
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]') {
      return null;
    }
    if (host.endsWith('.local') || host.endsWith('.localhost')) return null;
    if (isPrivateIpV4(host)) return null;
    // Anything else (public DNS name, public IPv4, or non-private IPv6) is treated
    // as a reverse-proxy candidate.
    return origin.toLowerCase().replace(/\/+$/, '');
  }, []);
}
