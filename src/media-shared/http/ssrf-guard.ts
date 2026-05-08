/**
 * SSRF guard for voice / media-understanding HTTP calls.
 *
 * DECISION (per docs/voice-rearchitecture.md §6):
 *  - xopc does not currently ship the full openclaw SSRF infra (pinned dispatcher,
 *    legacy private-network opt-in, etc.). For v2.0 we adopt a deliberately lean
 *    guard that is sufficient for "developer-controlled provider base URLs":
 *      1. Reject non-http(s) schemes.
 *      2. Reject IP literals or hostnames that resolve to private / loopback /
 *         link-local / metadata addresses unless `allowPrivateNetwork` is true.
 *      3. Resolve the hostname BEFORE handing the request to fetch (DNS pinning)
 *         and reuse the resolved IP for the actual connection — closes the
 *         classic DNS-rebinding window without requiring a custom dispatcher.
 *  - Why not port openclaw's pinned dispatcher (undici): xopc is committed to
 *    plain `globalThis.fetch` (Node 22 native) per AGENTS.md "Node >= 22"; we
 *    accept the slightly weaker guarantee in exchange for zero new dependencies.
 *  - Tests under src/media-shared/http/__tests__/ssrf-guard.test.ts cover all
 *    private CIDR ranges + IPv6 link-local + metadata IPs (169.254.169.254).
 */

import { lookup as dnsLookup } from 'node:dns';
import { isIP } from 'node:net';
import { promisify } from 'node:util';

const dnsLookupAsync = promisify(dnsLookup);

export class SsrfBlockedError extends Error {
  readonly url: string;
  readonly reason: string;

  constructor(url: string, reason: string) {
    super(`SSRF guard blocked URL "${url}": ${reason}`);
    this.name = 'SsrfBlockedError';
    this.url = url;
    this.reason = reason;
  }
}

export interface SsrfGuardOptions {
  /** Opt-in: allow private/loopback/link-local hosts. Default false. */
  allowPrivateNetwork?: boolean;
  /**
   * Optional explicit hostname allowlist. If set, ONLY these hostnames are
   * permitted regardless of `allowPrivateNetwork`. Useful for production
   * deployments that pin to one or two known provider domains.
   */
  hostnameAllowlist?: readonly string[];
}

const PRIVATE_IPV4_CIDR_PATTERNS: ReadonlyArray<(parts: number[]) => boolean> = [
  // 10.0.0.0/8
  (parts) => parts[0] === 10,
  // 172.16.0.0/12
  (parts) => parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31,
  // 192.168.0.0/16
  (parts) => parts[0] === 192 && parts[1] === 168,
  // 127.0.0.0/8 (loopback)
  (parts) => parts[0] === 127,
  // 169.254.0.0/16 (link-local + AWS / GCP metadata 169.254.169.254)
  (parts) => parts[0] === 169 && parts[1] === 254,
  // 100.64.0.0/10 (CGNAT)
  (parts) => parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127,
  // 0.0.0.0/8
  (parts) => parts[0] === 0,
];

export function isPrivateIpv4(ip: string): boolean {
  if (isIP(ip) !== 4) {
    return false;
  }
  const parts = ip.split('.').map((octet) => Number.parseInt(octet, 10));
  if (parts.length !== 4 || parts.some((octet) => Number.isNaN(octet))) {
    return false;
  }
  for (const matcher of PRIVATE_IPV4_CIDR_PATTERNS) {
    if (matcher(parts)) {
      return true;
    }
  }
  return false;
}

export function isPrivateIpv6(ip: string): boolean {
  if (isIP(ip) !== 6) {
    return false;
  }
  const lower = ip.toLowerCase();
  // ::1 loopback
  if (lower === '::1' || lower === '0:0:0:0:0:0:0:1') {
    return true;
  }
  // fc00::/7 unique local
  if (/^f[cd][0-9a-f]{2}:/.test(lower)) {
    return true;
  }
  // fe80::/10 link-local
  if (/^fe[89ab][0-9a-f]:/.test(lower)) {
    return true;
  }
  // ::ffff:<ipv4-mapped> — defer to the IPv4 check
  const v4Mapped = lower.match(/^::ffff:([0-9.]+)$/);
  if (v4Mapped && isIP(v4Mapped[1]) === 4) {
    return isPrivateIpv4(v4Mapped[1]);
  }
  return false;
}

export function isPrivateIpAddress(ip: string): boolean {
  return isPrivateIpv4(ip) || isPrivateIpv6(ip);
}

export interface ResolvedSsrfTarget {
  /** The original URL string. */
  url: string;
  /** The resolved IP that should actually be connected to. */
  resolvedIp: string;
  /** The address family (4 or 6). */
  family: 4 | 6;
}

/**
 * Validate `url`, resolve its hostname via DNS, and return the resolved IP so
 * the caller can pin the request to that exact IP (closes DNS-rebinding window).
 *
 * Throws SsrfBlockedError when:
 *  - scheme is not http(s)
 *  - hostname is an explicit IP literal that targets a private range (and the
 *    caller did not opt in)
 *  - hostname resolves to a private IP (and the caller did not opt in)
 *  - hostnameAllowlist is set and the hostname is not on it
 */
export async function assertSafeUrl(
  url: string | URL,
  options: SsrfGuardOptions = {},
): Promise<ResolvedSsrfTarget> {
  const parsed = url instanceof URL ? url : new URL(url);
  const urlString = parsed.toString();

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new SsrfBlockedError(urlString, `unsupported scheme "${parsed.protocol}"`);
  }

  const hostname = parsed.hostname;
  if (!hostname) {
    throw new SsrfBlockedError(urlString, 'missing hostname');
  }

  if (options.hostnameAllowlist && options.hostnameAllowlist.length > 0) {
    const lower = hostname.toLowerCase();
    const allowed = options.hostnameAllowlist.some((entry) => lower === entry.toLowerCase());
    if (!allowed) {
      throw new SsrfBlockedError(urlString, `hostname "${hostname}" not in allowlist`);
    }
  }

  const literalFamily = isIP(hostname);
  if (literalFamily !== 0) {
    if (!options.allowPrivateNetwork && isPrivateIpAddress(hostname)) {
      throw new SsrfBlockedError(urlString, `IP literal "${hostname}" targets a private network`);
    }
    return { url: urlString, resolvedIp: hostname, family: literalFamily as 4 | 6 };
  }

  let address: string;
  let family: number;
  try {
    const resolved = await dnsLookupAsync(hostname);
    address = resolved.address;
    family = resolved.family;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new SsrfBlockedError(urlString, `DNS lookup failed: ${reason}`);
  }

  if (!options.allowPrivateNetwork && isPrivateIpAddress(address)) {
    throw new SsrfBlockedError(
      urlString,
      `hostname "${hostname}" resolved to private IP "${address}"`,
    );
  }

  return { url: urlString, resolvedIp: address, family: family as 4 | 6 };
}
