/**
 * WebSocket / gateway URL transport security (OpenClaw-aligned).
 */

import net from 'node:net';

import { isLoopbackHost } from './host.js';

function isPrivateOrLoopbackHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase();
  if (isLoopbackHost(host)) {
    return true;
  }

  const ipVersion = net.isIP(host);
  if (ipVersion === 4) {
    const parts = host.split('.').map((p) => Number(p));
    if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n))) {
      return false;
    }
    const [a, b] = parts;
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true;
    return false;
  }

  if (ipVersion === 6) {
    return host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80');
  }

  return false;
}

export function isInsecurePrivateWsAllowed(): boolean {
  return process.env.XOPC_ALLOW_INSECURE_PRIVATE_WS === '1';
}

/**
 * Returns true when the URL is safe for credentials and sensitive payloads:
 * - wss:// is always allowed
 * - ws:// is allowed only on loopback by default
 * - optional break-glass: private-network ws:// when XOPC_ALLOW_INSECURE_PRIVATE_WS=1
 */
export function isSecureWebSocketUrl(
  url: string,
  opts?: { allowPrivateWs?: boolean },
): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  const protocol =
    parsed.protocol === 'https:'
      ? 'wss:'
      : parsed.protocol === 'http:'
        ? 'ws:'
        : parsed.protocol;

  if (protocol === 'wss:') {
    return true;
  }

  if (protocol !== 'ws:') {
    return false;
  }

  if (isLoopbackHost(parsed.hostname)) {
    return true;
  }

  const allowPrivateWs = opts?.allowPrivateWs ?? isInsecurePrivateWsAllowed();
  if (allowPrivateWs) {
    if (isPrivateOrLoopbackHost(parsed.hostname)) {
      return true;
    }
    const hostForIpCheck =
      parsed.hostname.startsWith('[') && parsed.hostname.endsWith(']')
        ? parsed.hostname.slice(1, -1)
        : parsed.hostname;
    return net.isIP(hostForIpCheck) === 0;
  }

  return false;
}

export function assertSecureWebSocketUrl(url: string, opts?: { allowPrivateWs?: boolean }): void {
  if (isSecureWebSocketUrl(url, opts)) {
    return;
  }
  throw new Error(
    `insecure WebSocket URL rejected: ${url} (use wss://, loopback ws://, or set XOPC_ALLOW_INSECURE_PRIVATE_WS=1 for trusted private networks)`,
  );
}

/**
 * Normalize http(s) gateway base URLs for fetch clients; rejects insecure ws targets.
 */
export function assertSecureGatewayHttpUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`invalid gateway URL: ${url}`);
  }
  if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
    if (parsed.protocol === 'http:' && !isLoopbackHost(parsed.hostname)) {
      throw new Error(
        `insecure gateway HTTP URL rejected: ${url} (use https:// or loopback http://127.0.0.1)`,
      );
    }
    return;
  }
  assertSecureWebSocketUrl(url);
}
