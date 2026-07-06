export type GatewayProfile = {
  id: string;
  name: string;
  baseUrl: string;
  lanUrl: string | null;
  token: string;
  updatedAt: number;
};

export type GatewayProfileInput = {
  name?: string;
  baseUrl: string;
  lanUrl?: string | null;
  token?: string;
};

export function normalizeGatewayBaseUrl(raw: string): string {
  return ensureGatewayUrlScheme(raw.trim().replace(/\/+$/, ''));
}

/** Add http(s) when missing so React Native fetch gets an absolute URL (browser does this implicitly). */
export function ensureGatewayUrlScheme(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (isLocalOrPrivateGatewayHost(trimmed)) return `http://${trimmed}`;
  return `https://${trimmed}`;
}

export function isLocalOrPrivateGatewayHost(host: string): boolean {
  const candidate = /^https?:\/\//i.test(host) ? host : `http://${host}`;
  try {
    const { hostname } = new URL(candidate);
    if (hostname === 'localhost' || hostname.endsWith('.local')) return true;
    const parts = hostname.split('.');
    if (parts.length !== 4) return false;
    const octets = parts.map((p) => Number(p));
    if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
    if (octets[0] === 10) return true;
    if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) return true;
    if (octets[0] === 192 && octets[1] === 168) return true;
    if (octets[0] === 127) return true;
    return false;
  } catch {
    return false;
  }
}

/** True when this gateway root URL points back to the current device. */
export function isLoopbackGatewayBaseUrl(raw: string): boolean {
  const normalized = normalizeGatewayBaseUrl(raw);
  if (!normalized) return false;
  try {
    const { hostname } = new URL(normalized);
    const host = hostname.toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true;
    if (/^127\.\d+\.\d+\.\d+$/.test(host)) return true;
    return false;
  } catch {
    return false;
  }
}

export function isGatewayLoopbackAllowedInDev(): boolean {
  return (globalThis as { __DEV__?: boolean }).__DEV__ === true;
}

export function shouldRejectLoopbackGatewayBaseUrl(raw: string): boolean {
  return isLoopbackGatewayBaseUrl(raw) && !isGatewayLoopbackAllowedInDev();
}

export function gatewayProfileNameFromUrl(baseUrl: string): string {
  try {
    return new URL(baseUrl).hostname || baseUrl;
  } catch {
    return baseUrl;
  }
}

export function createGatewayProfileId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `gw_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function buildGatewayProfile(input: GatewayProfileInput, id?: string): GatewayProfile {
  const baseUrl = normalizeGatewayBaseUrl(input.baseUrl);
  return {
    id: id ?? createGatewayProfileId(),
    name: input.name?.trim() || gatewayProfileNameFromUrl(baseUrl),
    baseUrl,
    lanUrl: input.lanUrl?.trim() ? normalizeGatewayBaseUrl(input.lanUrl) : null,
    token: (input.token ?? '').trim(),
    updatedAt: Date.now(),
  };
}

/** Best URL for API calls: probed route, tunnel, then LAN fallback. */
export function resolveEffectiveGatewayBaseUrl(input: {
  activeBaseUrl: string;
  baseUrl: string;
  lanUrl: string | null;
}): string {
  for (const raw of [input.activeBaseUrl, input.baseUrl, input.lanUrl ?? '']) {
    const normalized = normalizeGatewayBaseUrl(raw);
    if (normalized) return normalized;
  }
  return '';
}

export function preferredActiveBaseUrlFromFlat(input: {
  baseUrl: string;
  lanUrl: string | null;
}): string {
  const base = normalizeGatewayBaseUrl(input.baseUrl);
  const lan = input.lanUrl ? normalizeGatewayBaseUrl(input.lanUrl) : '';
  return lan || base;
}
