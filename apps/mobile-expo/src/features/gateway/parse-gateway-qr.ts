/** Parsed fields from a QR payload (URL, JSON, or plain gateway URL). */
export type ParsedGatewayQr = {
  baseUrl?: string;
  lanUrl?: string;
  /** One-time pairing secret from `ps` query param. */
  pairingSecret?: string;
};

function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function trimBase(raw: string): string {
  return raw.trim().replace(/\/+$/, '');
}

/** Decode `baseUrl` query value (may be single- or double-encoded). */
function decodeQueryParam(value: string): string {
  const raw = value.trim();
  if (!raw) return '';
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function decodeLayeredURIComponent(enc: string): string {
  let s = enc.trim();
  for (let i = 0; i < 4; i++) {
    try {
      const next = decodeURIComponent(s);
      if (next === s) break;
      s = next;
    } catch {
      break;
    }
  }
  return s.trim();
}

function isMobileConnectPath(pathname: string): boolean {
  const p = pathname.replace(/\/+$/, '') || '/';
  return p === '/mobile-connect' || p.endsWith('/mobile-connect');
}

/**
 * Interpret QR / deep-link text for gateway onboarding.
 * Supports:
 * - `xopc://gateway/mobile-connect?baseUrl=…&lanUrl=…&ps=…` (preferred)
 * - JSON `{"baseUrl","ps"}`, http(s) URLs with optional query params, plain URLs.
 */
export function parseGatewayQrPayload(raw: string): ParsedGatewayQr {
  const t = raw.trim();
  if (!t) return {};

  if (t.startsWith('{')) {
    try {
      const o = JSON.parse(t) as Record<string, unknown>;
      const url =
        (typeof o.baseUrl === 'string' && o.baseUrl) ||
        (typeof o.url === 'string' && o.url) ||
        (typeof o.gatewayUrl === 'string' && o.gatewayUrl) ||
        '';
      const pairingSecret =
        (typeof o.ps === 'string' && o.ps) ||
        (typeof o.pairingSecret === 'string' && o.pairingSecret) ||
        '';
      const out: ParsedGatewayQr = {};
      if (url.trim()) out.baseUrl = trimBase(url);
      if (pairingSecret.trim()) out.pairingSecret = pairingSecret.trim();
      return out;
    } catch {
      return {};
    }
  }

  try {
    const u = new URL(t);
    const scheme = u.protocol.replace(/:$/, '').toLowerCase();
    if (
      (scheme === 'xopc' || scheme === 'xopc-mobile') &&
      u.hostname.toLowerCase() === 'gateway' &&
      isMobileConnectPath(u.pathname)
    ) {
      const encBase = u.searchParams.get('baseUrl') ?? '';
      const encLan = u.searchParams.get('lanUrl') ?? '';
      const pairingSecret = decodeQueryParam(
        u.searchParams.get('ps') ?? u.searchParams.get('pairingSecret') ?? '',
      );
      const baseDecoded = decodeLayeredURIComponent(encBase);
      const lanDecoded = decodeLayeredURIComponent(encLan);
      const out: ParsedGatewayQr = {};
      if (baseDecoded && isHttpUrl(baseDecoded)) out.baseUrl = trimBase(baseDecoded);
      if (lanDecoded && isHttpUrl(lanDecoded)) out.lanUrl = trimBase(lanDecoded);
      if (pairingSecret) out.pairingSecret = pairingSecret;
      if (out.baseUrl || out.lanUrl || out.pairingSecret) return out;
    }
  } catch {
    /* fall through */
  }

  try {
    const u = new URL(t);
    if (isHttpUrl(t)) {
      const pairingSecret = decodeQueryParam(
        u.searchParams.get('ps') ?? u.searchParams.get('pairingSecret') ?? '',
      );
      u.search = '';
      u.hash = '';
      const baseUrl = trimBase(u.toString());
      const out: ParsedGatewayQr = { baseUrl };
      if (pairingSecret) out.pairingSecret = pairingSecret;
      return out;
    }
  } catch {
    /* fall through */
  }

  if (isHttpUrl(t)) return { baseUrl: trimBase(t) };
  return {};
}

export function hasPairableGatewayQr(parsed: ParsedGatewayQr): boolean {
  return Boolean(parsed.pairingSecret?.trim() && parsed.baseUrl?.trim());
}
