/**
 * Browser Origin checking for CSRF protection on HTTP and WebSocket requests.
 *
 * Validates that browser-initiated requests come from an allowed origin.
 * Non-browser requests (no Origin header) are handled by other auth layers.
 */

type OriginCheckResult =
  | { ok: true; matchedBy: 'allowlist' | 'host-header-fallback' | 'local-loopback' }
  | { ok: false; reason: string };

const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK_HOSTNAMES.has(hostname.toLowerCase());
}

function parseOriginHost(originRaw?: string): { origin: string; host: string; hostname: string } | null {
  const trimmed = (originRaw ?? '').trim();
  if (!trimmed || trimmed === 'null') {
    return null;
  }
  try {
    const url = new URL(trimmed);
    return {
      origin: url.origin.toLowerCase(),
      host: url.host.toLowerCase(),
      hostname: url.hostname.toLowerCase(),
    };
  } catch {
    return null;
  }
}

function normalizeHostHeader(hostRaw?: string): string {
  const trimmed = (hostRaw ?? '').trim().toLowerCase();
  // Strip port if present for comparison
  return trimmed;
}

export function checkBrowserOrigin(params: {
  requestHost?: string;
  origin?: string;
  allowedOrigins?: string[];
  allowHostHeaderOriginFallback?: boolean;
  isLocalClient?: boolean;
}): OriginCheckResult {
  const parsedOrigin = parseOriginHost(params.origin);
  if (!parsedOrigin) {
    return { ok: false, reason: 'origin missing or invalid' };
  }

  const allowlist = new Set(
    (params.allowedOrigins ?? [])
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
  if (allowlist.has('*') || allowlist.has(parsedOrigin.origin)) {
    return { ok: true, matchedBy: 'allowlist' };
  }

  const requestHost = normalizeHostHeader(params.requestHost);
  if (
    params.allowHostHeaderOriginFallback === true &&
    requestHost &&
    parsedOrigin.host === requestHost
  ) {
    return { ok: true, matchedBy: 'host-header-fallback' };
  }

  // Dev fallback only for genuinely local socket clients, not Host-header claims.
  if (params.isLocalClient && isLoopbackHost(parsedOrigin.hostname)) {
    return { ok: true, matchedBy: 'local-loopback' };
  }

  return { ok: false, reason: 'origin not allowed' };
}
