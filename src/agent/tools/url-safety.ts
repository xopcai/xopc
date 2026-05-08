/**
 * URL safety checks for web tools — blocks requests to private/internal
 * network addresses and cloud metadata endpoints (SSRF protection).
 *
 * Prevents Server-Side Request Forgery where a malicious prompt could trick
 * the agent into fetching internal resources like cloud metadata endpoints
 * (169.254.169.254), localhost services, or private network hosts.
 *
 * Cloud metadata endpoints are ALWAYS blocked regardless of any toggle —
 * they are never legitimate agent targets.
 *
 * Inspired by hermes-agent's `url_safety.py`.
 */
import { isIPv4, isIPv6 } from 'node:net';

import { createLogger } from '../../utils/logger.js';

const log = createLogger('url-safety');

// ---------------------------------------------------------------------------
// Always-blocked: cloud metadata endpoints
// ---------------------------------------------------------------------------

/** Hostnames that are always blocked (cloud metadata services). */
const BLOCKED_HOSTNAMES = new Set([
  'metadata.google.internal',
  'metadata.goog',
]);

/** IPs that are always blocked regardless of any toggle. */
const ALWAYS_BLOCKED_IPS = new Set([
  '169.254.169.254', // AWS/GCP/Azure/DO/Oracle metadata
  '169.254.170.2',   // AWS ECS task metadata (task IAM creds)
  '169.254.169.253', // Azure IMDS wire server
  '100.100.100.200', // Alibaba Cloud metadata
]);

// ---------------------------------------------------------------------------
// Private IP detection
// ---------------------------------------------------------------------------

function isBlockedIPv4(host: string): boolean {
  const parts = host.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true;
  }
  const [octet1, octet2] = parts;
  if (octet1 === 10) return true;                               // 10.0.0.0/8
  if (octet1 === 127) return true;                               // 127.0.0.0/8
  if (octet1 === 0) return true;                                 // 0.0.0.0/8
  if (octet1 === 169 && octet2 === 254) return true;             // 169.254.0.0/16 link-local
  if (octet1 === 192 && octet2 === 168) return true;             // 192.168.0.0/16
  if (octet1 === 172 && octet2 >= 16 && octet2 <= 31) return true; // 172.16.0.0/12
  if (octet1 === 100 && octet2 >= 64 && octet2 <= 127) return true; // 100.64.0.0/10 CGNAT
  return false;
}

function isBlockedIPv6(host: string): boolean {
  const normalized = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (normalized === '::1') return true;                 // loopback
  if (normalized.startsWith('fe80:')) return true;       // link-local
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true; // ULA
  return false;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface UrlSafetyResult {
  safe: boolean;
  reason?: string;
}

/**
 * Check whether a URL is safe to fetch (not targeting private/internal addresses).
 *
 * Blocks:
 * - Cloud metadata endpoints (always, non-negotiable)
 * - Private/loopback/link-local IP addresses
 * - localhost and internal hostnames
 * - URLs with embedded credentials
 * - Non-HTTP(S) schemes
 *
 * Returns `{ safe: true }` for allowed URLs,
 * or `{ safe: false, reason }` for blocked ones.
 */
export function checkUrlSafety(rawUrl: string): UrlSafetyResult {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return { safe: false, reason: 'Invalid URL' };
  }

  // Block non-HTTP(S) schemes
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { safe: false, reason: 'Only http and https URLs are allowed' };
  }

  // Block embedded credentials
  if (url.username || url.password) {
    return { safe: false, reason: 'URLs with embedded credentials are not allowed' };
  }

  const rawHost = url.hostname.toLowerCase();
  if (!rawHost) {
    return { safe: false, reason: 'Missing hostname' };
  }

  // URL API keeps brackets for IPv6 (e.g. "[::1]") — strip for checks
  const host = rawHost.replace(/^\[|\]$/g, '');

  // Always block cloud metadata hostnames
  if (BLOCKED_HOSTNAMES.has(host)) {
    log.warn({ host }, 'Blocked request to cloud metadata hostname');
    return { safe: false, reason: `Blocked: cloud metadata endpoint '${host}'` };
  }

  // Block localhost
  if (host === 'localhost' || host.endsWith('.localhost')) {
    return { safe: false, reason: 'Blocked: localhost' };
  }

  // Block internal TLDs
  if (host.endsWith('.local') || host.endsWith('.internal')) {
    return { safe: false, reason: 'Blocked: internal hostname' };
  }

  // IPv4 checks
  if (isIPv4(host)) {
    // Always block cloud metadata IPs first
    if (ALWAYS_BLOCKED_IPS.has(host)) {
      log.warn({ host }, 'Blocked request to cloud metadata IP');
      return { safe: false, reason: `Blocked: cloud metadata address ${host}` };
    }
    if (isBlockedIPv4(host)) {
      return { safe: false, reason: 'Blocked: private or non-public IPv4 address' };
    }
    return { safe: true };
  }

  // IPv6 checks
  if (isIPv6(host)) {
    if (isBlockedIPv6(host)) {
      return { safe: false, reason: 'Blocked: private or loopback IPv6 address' };
    }
    return { safe: true };
  }

  return { safe: true };
}

/**
 * Assert that a URL is safe to fetch. Throws on blocked URLs.
 * Convenience wrapper over {@link checkUrlSafety}.
 */
export function assertUrlSafe(rawUrl: string): void {
  const result = checkUrlSafety(rawUrl);
  if (!result.safe) {
    throw new Error(result.reason ?? 'URL blocked by safety check');
  }
}

// ---------------------------------------------------------------------------
// Website blocklist (user-configurable domain blocking)
// ---------------------------------------------------------------------------

export interface WebsiteBlocklistConfig {
  enabled?: boolean;
  /** Domain patterns to block (e.g. "example.com", "*.evil.org"). */
  domains?: string[];
}

/**
 * Normalize a domain pattern for matching:
 * strips protocol, path, www. prefix, trailing dots.
 */
function normalizeDomainPattern(raw: string): string | undefined {
  let value = raw.trim().toLowerCase();
  if (!value || value.startsWith('#')) return undefined;

  // Strip protocol if present
  if (value.includes('://')) {
    try {
      const parsed = new URL(value);
      value = parsed.hostname;
    } catch {
      value = value.split('://')[1] ?? value;
    }
  }

  // Strip path, port
  value = value.split('/')[0].split(':')[0].trim().replace(/\.+$/, '');

  // Strip www.
  if (value.startsWith('www.')) {
    value = value.slice(4);
  }

  return value || undefined;
}

function matchHostAgainstRule(host: string, pattern: string): boolean {
  if (!host || !pattern) return false;

  if (pattern.startsWith('*.')) {
    // Wildcard match: *.example.com matches foo.example.com and bar.foo.example.com
    const suffix = pattern.slice(2);
    return host === suffix || host.endsWith(`.${suffix}`);
  }

  // Exact match or subdomain match
  return host === pattern || host.endsWith(`.${pattern}`);
}

/**
 * Check whether a URL is blocked by the website blocklist.
 *
 * Returns `undefined` if allowed, or a block descriptor if blocked.
 */
export function checkWebsiteBlocklist(
  rawUrl: string,
  blocklist?: WebsiteBlocklistConfig,
): { host: string; rule: string; message: string } | undefined {
  if (!blocklist?.enabled || !blocklist.domains?.length) return undefined;

  let host: string;
  try {
    const url = new URL(rawUrl.trim());
    host = url.hostname.toLowerCase().replace(/\.+$/, '');
  } catch {
    return undefined; // let downstream URL validation handle parse errors
  }

  if (host.startsWith('www.')) {
    host = host.slice(4);
  }

  for (const rawRule of blocklist.domains) {
    const pattern = normalizeDomainPattern(rawRule);
    if (!pattern) continue;

    if (matchHostAgainstRule(host, pattern)) {
      log.info({ host, rule: pattern }, 'Blocked URL by website blocklist');
      return {
        host,
        rule: pattern,
        message: `Blocked by website policy: '${host}' matched rule '${pattern}'`,
      };
    }
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Base64 image cleaning
// ---------------------------------------------------------------------------

/**
 * Remove base64-encoded images from text to reduce token usage.
 * Strips patterns like `data:image/png;base64,...` and their markdown wrappers.
 */
export function cleanBase64Images(text: string): string {
  // Markdown images with base64 src: ![...](data:image/...;base64,...)
  let cleaned = text.replace(
    /!\[[^\]]*\]\(data:image\/[^;]+;base64,[A-Za-z0-9+/=]+\)/g,
    '[image removed]',
  );
  // Parenthesized base64 images
  cleaned = cleaned.replace(
    /\(data:image\/[^;]+;base64,[A-Za-z0-9+/=]+\)/g,
    '[image removed]',
  );
  // Bare base64 data URIs
  cleaned = cleaned.replace(
    /data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/g,
    '[image removed]',
  );

  return cleaned;
}
