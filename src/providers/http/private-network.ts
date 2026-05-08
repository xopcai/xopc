/**
 * SSRF / private-network protection for provider HTTP calls.
 *
 * Provider URLs are mostly user-controllable (cfg.providers.<id>.baseUrl,
 * imageBaseUrl, etc.). Without a guard a malicious config could make xopc
 * fetch internal services (169.254.x.x metadata, 127.0.0.1, RFC1918, …).
 *
 * Policy:
 *   - default: allow only http(s) + non-private hosts
 *   - dev:     allow loopback when XOPC_PROVIDER_HTTP_ALLOW_LOOPBACK=1
 *   - test:    same as dev; vitest sets NODE_ENV=test
 */

import { isIP } from 'node:net';

export interface PrivateNetworkPolicy {
  /** Permit 127.0.0.0/8, ::1, localhost. Default false. */
  allowLoopback?: boolean;
  /** Permit RFC1918 / link-local / unique-local. Default false. */
  allowPrivate?: boolean;
  /** Extra explicit hostname allowlist (exact match). */
  allowHosts?: ReadonlyArray<string>;
}

export class BlockedPrivateNetworkError extends Error {
  readonly url: string;
  readonly host: string;
  constructor(url: string, host: string, reason: string) {
    super(`Provider HTTP call blocked: ${reason} (host=${host}, url=${url})`);
    this.name = 'BlockedPrivateNetworkError';
    this.url = url;
    this.host = host;
  }
}

export function defaultPolicy(): PrivateNetworkPolicy {
  const env = process.env;
  const allowLoopback =
    env.XOPC_PROVIDER_HTTP_ALLOW_LOOPBACK === '1' ||
    env.XOPC_PROVIDER_HTTP_ALLOW_LOOPBACK === 'true' ||
    env.NODE_ENV === 'test';
  const allowPrivate =
    env.XOPC_PROVIDER_HTTP_ALLOW_PRIVATE === '1' || env.XOPC_PROVIDER_HTTP_ALLOW_PRIVATE === 'true';
  return { allowLoopback, allowPrivate };
}

/**
 * Throws {@link BlockedPrivateNetworkError} when the URL targets a private host
 * not permitted by the policy. Returns silently otherwise.
 *
 * Note: This is a best-effort guard at the URL layer. A truly hostile host
 * could still resolve a public name to a private IP via DNS rebinding; for
 * production deployments behind untrusted user input, also enforce egress
 * firewall rules.
 */
export function assertNotPrivateNetwork(rawUrl: string, policy: PrivateNetworkPolicy = defaultPolicy()): void {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new BlockedPrivateNetworkError(rawUrl, '', 'invalid URL');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new BlockedPrivateNetworkError(rawUrl, url.hostname, `unsupported protocol "${url.protocol}"`);
  }

  const host = url.hostname.toLowerCase();
  if (policy.allowHosts?.includes(host)) return;

  const cls = classifyHost(host);
  switch (cls) {
    case 'public':
      return;
    case 'loopback':
      if (policy.allowLoopback) return;
      throw new BlockedPrivateNetworkError(rawUrl, host, 'loopback address');
    case 'private':
      if (policy.allowPrivate) return;
      throw new BlockedPrivateNetworkError(rawUrl, host, 'private address');
    case 'link-local':
      if (policy.allowPrivate) return;
      throw new BlockedPrivateNetworkError(rawUrl, host, 'link-local address');
    case 'invalid':
      throw new BlockedPrivateNetworkError(rawUrl, host, 'invalid host');
  }
}

export type HostClass = 'public' | 'loopback' | 'private' | 'link-local' | 'invalid';

/** Classify a hostname/IP literal. Hostnames are conservatively treated as `public`. */
export function classifyHost(host: string): HostClass {
  if (!host) return 'invalid';
  const lower = host.toLowerCase();
  if (lower === 'localhost' || lower.endsWith('.localhost')) return 'loopback';

  const ipKind = isIP(lower);
  if (ipKind === 0) {
    // Hostname; cannot cheaply resolve here, treat as public.
    return 'public';
  }
  if (ipKind === 4) return classifyIPv4(lower);
  return classifyIPv6(lower);
}

function classifyIPv4(ip: string): HostClass {
  const parts = ip.split('.').map((s) => Number.parseInt(s, 10));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return 'invalid';
  }
  const [a, b] = parts;
  if (a === 127) return 'loopback';
  if (a === 10) return 'private';
  if (a === 172 && b >= 16 && b <= 31) return 'private';
  if (a === 192 && b === 168) return 'private';
  if (a === 169 && b === 254) return 'link-local';
  if (a === 0) return 'invalid';
  if (a === 100 && b >= 64 && b <= 127) return 'private'; // CGNAT 100.64.0.0/10
  return 'public';
}

function classifyIPv6(ip: string): HostClass {
  const lower = ip.toLowerCase();
  if (lower === '::1') return 'loopback';
  if (lower === '::') return 'invalid';
  if (lower.startsWith('fe80:')) return 'link-local';
  if (lower.startsWith('fc') || lower.startsWith('fd')) return 'private'; // unique-local fc00::/7
  if (lower.startsWith('::ffff:')) {
    // IPv4-mapped
    const v4 = lower.slice('::ffff:'.length);
    if (isIP(v4) === 4) return classifyIPv4(v4);
  }
  return 'public';
}
