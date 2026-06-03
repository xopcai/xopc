/**
 * Validation + normalization helpers for `gateway.publicUrl`.
 *
 * The publicUrl is a user-deployed reverse-proxy origin (e.g.
 * `https://gateway.example.com`). We accept it as both a config field and as
 * a one-off candidate (auto-detected from `window.location.origin`), so the
 * validator must run in identical shape on both surfaces.
 */

import net from 'node:net';

export type PublicUrlIssueCode =
  | 'invalid_url'
  | 'invalid_scheme'
  | 'has_userinfo'
  | 'has_path'
  | 'has_query_or_fragment'
  | 'requires_https';

export type PublicUrlValidation =
  | { ok: true; url: string; protocol: 'http:' | 'https:'; hostname: string }
  | { ok: false; code: PublicUrlIssueCode; message: string };

/** Lowercase RFC1918 / loopback / link-local / `.local` host match. */
export function isPrivateOrLocalHostname(hostname: string): boolean {
  const host = hostname.trim().toLowerCase();
  if (!host) return false;
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host.endsWith('.local')) return true;
  // IPv6 loopback / link-local
  if (host === '::1' || host === '[::1]') return true;
  if (host.startsWith('fe80:') || host.startsWith('[fe80:')) return true;
  if (host.startsWith('fc') || host.startsWith('fd')) {
    // fc00::/7 ULA
    if (net.isIPv6(host.replace(/^\[|\]$/g, ''))) return true;
  }
  // IPv4 private + loopback ranges
  if (net.isIPv4(host)) {
    const parts = host.split('.').map((p) => Number.parseInt(p, 10));
    if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return false;
    const [a, b] = parts;
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true; // link-local
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT — common for tailnet / mesh
  }
  return false;
}

/**
 * Validate a candidate publicUrl. Strict by design — we reject anything that
 * looks ambiguous so the QR payload is always a clean origin.
 */
export function validatePublicUrl(raw: string): PublicUrlValidation {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) {
    return { ok: false, code: 'invalid_url', message: 'publicUrl is empty' };
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, code: 'invalid_url', message: 'publicUrl is not a valid URL' };
  }
  const protocol = parsed.protocol.toLowerCase();
  if (protocol !== 'https:' && protocol !== 'http:') {
    return { ok: false, code: 'invalid_scheme', message: 'publicUrl must use http(s)' };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, code: 'has_userinfo', message: 'publicUrl must not contain userinfo' };
  }
  // pathname may be "/" (trailing slash) but nothing else
  const path = parsed.pathname;
  if (path && path !== '/' && path !== '') {
    return { ok: false, code: 'has_path', message: 'publicUrl must not contain a path' };
  }
  if (parsed.search || parsed.hash) {
    return {
      ok: false,
      code: 'has_query_or_fragment',
      message: 'publicUrl must not contain query or fragment',
    };
  }
  const hostname = parsed.hostname.toLowerCase();
  if (protocol === 'http:' && !isPrivateOrLocalHostname(hostname)) {
    return {
      ok: false,
      code: 'requires_https',
      message:
        'publicUrl must use https for public hostnames (http is only allowed for RFC1918 / .local)',
    };
  }
  // Normalize: drop trailing slash, lowercase host.
  const normalized = `${protocol}//${parsed.host.toLowerCase()}`;
  return {
    ok: true,
    url: normalized,
    protocol: protocol as 'http:' | 'https:',
    hostname,
  };
}

/** Convenience: return the normalized origin or `null` when invalid. */
export function normalizePublicUrlOrNull(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const result = validatePublicUrl(raw);
  return result.ok ? result.url : null;
}
