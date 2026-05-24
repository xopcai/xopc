import net from 'node:net';
import type { IncomingMessage } from 'node:http';

import { isLoopbackHost } from './host.js';

function stripIpv6Brackets(value: string): string {
  if (value.startsWith('[') && value.endsWith(']')) {
    return value.slice(1, -1);
  }
  return value;
}

function stripOptionalPort(ip: string): string {
  if (ip.startsWith('[')) {
    const end = ip.indexOf(']');
    if (end !== -1) {
      return ip.slice(1, end);
    }
  }
  if (net.isIP(ip)) {
    return ip;
  }
  const lastColon = ip.lastIndexOf(':');
  if (lastColon > -1 && ip.includes('.') && ip.indexOf(':') === lastColon) {
    const candidate = ip.slice(0, lastColon);
    if (net.isIP(candidate) === 4) {
      return candidate;
    }
  }
  return ip;
}

/** Normalize IP for comparison (strip zone id, brackets, IPv4-mapped prefix). */
export function normalizeIpAddress(ip: string | undefined): string | undefined {
  const trimmed = ip?.trim();
  if (!trimmed) {
    return undefined;
  }

  let value = stripOptionalPort(stripIpv6Brackets(trimmed));
  const zoneIdx = value.indexOf('%');
  if (zoneIdx > -1) {
    value = value.slice(0, zoneIdx);
  }

  if (value.startsWith('::ffff:')) {
    const mapped = value.slice('::ffff:'.length);
    if (net.isIP(mapped) === 4) {
      return mapped;
    }
  }

  if (net.isIP(value) === 0) {
    return undefined;
  }
  return value;
}

export function isLoopbackIpAddress(ip: string | undefined): boolean {
  const normalized = normalizeIpAddress(ip);
  if (!normalized) {
    return false;
  }
  return isLoopbackHost(normalized);
}

function ipv4ToInt(ip: string): number {
  const parts = ip.split('.').map((part) => Number.parseInt(part, 10));
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function isIpv4InCidr(ip: string, base: string, prefix: number): boolean {
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(base) & mask);
}

function parseIpv6BigInt(ip: string): bigint | undefined {
  try {
    const parts = ip.split(':');
    if (parts.length < 3) {
      return undefined;
    }
    let hextets: number[] = [];
    const emptyIdx = parts.indexOf('');
    if (emptyIdx !== -1) {
      const before = parts.slice(0, emptyIdx).filter(Boolean).map((h) => Number.parseInt(h, 16));
      const after = parts.slice(emptyIdx + 1).filter(Boolean).map((h) => Number.parseInt(h, 16));
      const missing = 8 - before.length - after.length;
      hextets = [...before, ...Array(Math.max(0, missing)).fill(0), ...after];
    } else {
      hextets = parts.map((h) => Number.parseInt(h, 16));
    }
    if (hextets.length !== 8 || hextets.some((h) => !Number.isFinite(h) || h < 0 || h > 0xffff)) {
      return undefined;
    }
    let value = 0n;
    for (const hextet of hextets) {
      value = (value << 16n) + BigInt(hextet);
    }
    return value;
  } catch {
    return undefined;
  }
}

function isIpv6InCidr(ip: string, base: string, prefix: number): boolean {
  const ipValue = parseIpv6BigInt(ip);
  const baseValue = parseIpv6BigInt(base);
  if (ipValue === undefined || baseValue === undefined) {
    return false;
  }
  if (prefix <= 0) {
    return true;
  }
  if (prefix >= 128) {
    return ipValue === baseValue;
  }
  const shift = BigInt(128 - prefix);
  return ipValue >> shift === baseValue >> shift;
}

/** Match an IP against a CIDR or exact address string. */
export function isIpInCidr(ip: string, cidr: string): boolean {
  const normalizedIp = normalizeIpAddress(ip);
  if (!normalizedIp) {
    return false;
  }
  const candidate = cidr.trim();
  if (!candidate) {
    return false;
  }

  if (!candidate.includes('/')) {
    const exact = normalizeIpAddress(candidate);
    return exact === normalizedIp;
  }

  const [baseRaw, prefixRaw] = candidate.split('/');
  const base = normalizeIpAddress(baseRaw);
  const prefix = Number.parseInt(prefixRaw ?? '', 10);
  if (!base || !Number.isInteger(prefix)) {
    return false;
  }

  const ipKind = net.isIP(normalizedIp);
  const baseKind = net.isIP(base);
  if (ipKind !== baseKind) {
    return false;
  }

  if (ipKind === 4) {
    if (prefix < 0 || prefix > 32) {
      return false;
    }
    return isIpv4InCidr(normalizedIp, base, prefix);
  }

  if (prefix < 0 || prefix > 128) {
    return false;
  }
  return isIpv6InCidr(normalizedIp, base, prefix);
}

export function isTrustedProxyAddress(ip: string | undefined, trustedProxies?: string[]): boolean {
  const normalized = normalizeIpAddress(ip);
  if (!normalized || !trustedProxies?.length) {
    return false;
  }
  return trustedProxies.some((proxy) => {
    const candidate = proxy.trim();
    return candidate.length > 0 && isIpInCidr(normalized, candidate);
  });
}

function parseIpLiteral(raw: string | undefined): string | undefined {
  return normalizeIpAddress(raw);
}

function resolveForwardedClientIp(params: {
  forwardedFor?: string;
  trustedProxies?: string[];
}): string | undefined {
  const { forwardedFor, trustedProxies } = params;
  if (!trustedProxies?.length) {
    return undefined;
  }

  const forwardedChain: string[] = [];
  for (const entry of forwardedFor?.split(',') ?? []) {
    const normalized = parseIpLiteral(entry);
    if (normalized) {
      forwardedChain.push(normalized);
    }
  }
  if (forwardedChain.length === 0) {
    return undefined;
  }

  for (let index = forwardedChain.length - 1; index >= 0; index -= 1) {
    const hop = forwardedChain[index];
    if (isLoopbackIpAddress(hop)) {
      continue;
    }
    if (!isTrustedProxyAddress(hop, trustedProxies)) {
      return hop;
    }
  }
  return undefined;
}

export function resolveClientIp(params: {
  remoteAddr?: string;
  forwardedFor?: string;
  realIp?: string;
  trustedProxies?: string[];
  /** Default false: only trust X-Real-IP when explicitly enabled. */
  allowRealIpFallback?: boolean;
}): string | undefined {
  const remote = normalizeIpAddress(params.remoteAddr);
  if (!remote) {
    return undefined;
  }
  if (!isTrustedProxyAddress(remote, params.trustedProxies)) {
    return remote;
  }

  const forwardedIp = resolveForwardedClientIp({
    forwardedFor: params.forwardedFor,
    trustedProxies: params.trustedProxies,
  });
  if (forwardedIp) {
    return forwardedIp;
  }
  if (params.allowRealIpFallback) {
    return parseIpLiteral(params.realIp);
  }
  return undefined;
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function resolveRequestClientIp(
  req?: IncomingMessage,
  trustedProxies?: string[],
  allowRealIpFallback = false,
): string | undefined {
  if (!req) {
    return undefined;
  }
  return resolveClientIp({
    remoteAddr: req.socket?.remoteAddress ?? '',
    forwardedFor: headerValue(req.headers?.['x-forwarded-for']),
    realIp: headerValue(req.headers?.['x-real-ip']),
    trustedProxies,
    allowRealIpFallback,
  });
}

export function resolveClientIpFromRequest(params: {
  remoteAddress?: string;
  getHeader: (name: string) => string | undefined;
  trustedProxies?: string[];
  allowRealIpFallback?: boolean;
}): string {
  return (
    resolveClientIp({
      remoteAddr: params.remoteAddress,
      forwardedFor: params.getHeader('x-forwarded-for'),
      realIp: params.getHeader('x-real-ip'),
      trustedProxies: params.trustedProxies,
      allowRealIpFallback: params.allowRealIpFallback,
    }) ?? 'unknown'
  );
}
