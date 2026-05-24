import { existsSync } from 'node:fs';
import net from 'node:net';

import type { Config } from '../config/schema.js';
import type { GatewayBindMode } from '../config/schema.js';
import { isAllInterfacesHost, isLoopbackHost } from '../gateway/host.js';

export type { GatewayBindMode };

/** Infer bind mode from a legacy `gateway.host` string. */
export function inferBindModeFromHost(host: string): GatewayBindMode {
  const normalized = host.trim().toLowerCase();
  if (
    normalized === '127.0.0.1' ||
    normalized === 'localhost' ||
    normalized === '::1' ||
    normalized === '0:0:0:0:0:0:0:1'
  ) {
    return 'loopback';
  }
  if (normalized === '0.0.0.0' || normalized === '::' || normalized === '*') {
    return 'lan';
  }
  return 'custom';
}

export function resolveGatewayBindMode(
  cfg: Config,
  bindOverride?: GatewayBindMode,
): GatewayBindMode {
  if (bindOverride) {
    return bindOverride;
  }
  const configured = cfg.gateway?.bind;
  if (configured) {
    return configured;
  }
  const legacyHost = cfg.gateway?.host?.trim();
  if (legacyHost) {
    return inferBindModeFromHost(legacyHost);
  }
  return defaultGatewayBindMode();
}

export function bindModeFromHostOverride(host: string): {
  bind: GatewayBindMode;
  customBindHost?: string;
} {
  const trimmed = host.trim();
  const bind = inferBindModeFromHost(trimmed);
  if (bind === 'custom') {
    return { bind, customBindHost: trimmed };
  }
  return { bind };
}

/** Legacy `gateway.host` value derived from bind mode (for readers that still use host). */
export function syncLegacyGatewayHostFromBind(params: {
  bind: GatewayBindMode;
  customBindHost?: string;
}): string {
  switch (params.bind) {
    case 'loopback':
      return '127.0.0.1';
    case 'lan':
      return '0.0.0.0';
    case 'custom':
      return params.customBindHost?.trim() || '127.0.0.1';
    case 'auto':
      return isContainerEnvironment() ? '0.0.0.0' : '127.0.0.1';
    case 'tailnet':
      return pickPrimaryTailnetIPv4() ?? '127.0.0.1';
    default:
      return '127.0.0.1';
  }
}

export function resolveGatewayCustomBindHost(cfg: Config, override?: string): string | undefined {
  const fromOverride = override?.trim();
  if (fromOverride) {
    return fromOverride;
  }
  const fromConfig = cfg.gateway?.customBindHost?.trim();
  if (fromConfig) {
    return fromConfig;
  }
  const legacyHost = cfg.gateway?.host?.trim();
  if (legacyHost && inferBindModeFromHost(legacyHost) === 'custom') {
    return legacyHost;
  }
  return undefined;
}

let containerEnvironmentCache: boolean | undefined;

export function isContainerEnvironment(): boolean {
  if (containerEnvironmentCache !== undefined) {
    return containerEnvironmentCache;
  }
  if (process.env.XOPC_CONTAINER === '1' || process.env.KUBERNETES_SERVICE_HOST) {
    containerEnvironmentCache = true;
    return true;
  }
  try {
    if (existsSync('/.dockerenv')) {
      containerEnvironmentCache = true;
      return true;
    }
  } catch {
    // ignore
  }
  containerEnvironmentCache = false;
  return false;
}

/** Reset cached container detection (tests). */
export function resetContainerEnvironmentCacheForTest(): void {
  containerEnvironmentCache = undefined;
}

export function defaultGatewayBindMode(): GatewayBindMode {
  return isContainerEnvironment() ? 'auto' : 'loopback';
}

/** Placeholder for Tailscale tailnet bind; returns undefined when tailnet IP is unavailable. */
export function pickPrimaryTailnetIPv4(): string | undefined {
  return undefined;
}

export function isValidIPv4(host: string): boolean {
  const parts = host.trim().split('.');
  if (parts.length !== 4) {
    return false;
  }
  return parts.every((part) => {
    if (!/^\d+$/.test(part)) {
      return false;
    }
    const n = Number(part);
    return Number.isInteger(n) && n >= 0 && n <= 255;
  });
}

export function resolveGatewayBindHostSync(params: {
  bindMode: GatewayBindMode;
  customBindHost?: string;
}): string {
  const { bindMode, customBindHost } = params;

  if (bindMode === 'loopback') {
    return '127.0.0.1';
  }
  if (bindMode === 'lan') {
    return '0.0.0.0';
  }
  if (bindMode === 'auto') {
    return isContainerEnvironment() ? '0.0.0.0' : '127.0.0.1';
  }
  if (bindMode === 'tailnet') {
    return pickPrimaryTailnetIPv4() ?? '127.0.0.1';
  }
  if (bindMode === 'custom') {
    const host = customBindHost?.trim();
    if (!host || !isValidIPv4(host)) {
      throw new Error('gateway.bind=custom requires a valid IPv4 gateway.customBindHost');
    }
    return host;
  }
  return '127.0.0.1';
}

export async function canBindToHost(host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const testServer = net.createServer();
    testServer.once('error', () => resolve(false));
    testServer.once('listening', () => {
      testServer.close();
      resolve(true);
    });
    testServer.listen(0, host);
  });
}

/**
 * Resolve gateway bind host with optional bindability probe (OpenClaw-aligned).
 */
export async function resolveGatewayBindHost(params: {
  bindMode: GatewayBindMode;
  customBindHost?: string;
}): Promise<string> {
  const mode = params.bindMode;

  if (mode === 'loopback') {
    if (await canBindToHost('127.0.0.1')) {
      return '127.0.0.1';
    }
    return '0.0.0.0';
  }

  if (mode === 'tailnet') {
    const tailnetIp = pickPrimaryTailnetIPv4();
    if (tailnetIp && (await canBindToHost(tailnetIp))) {
      return tailnetIp;
    }
    if (await canBindToHost('127.0.0.1')) {
      return '127.0.0.1';
    }
    return '0.0.0.0';
  }

  if (mode === 'lan') {
    return '0.0.0.0';
  }

  if (mode === 'custom') {
    const host = params.customBindHost?.trim();
    if (!host) {
      throw new Error('gateway.bind=custom requires gateway.customBindHost');
    }
    if (!isValidIPv4(host)) {
      throw new Error(`gateway.bind=custom requires a valid IPv4 customBindHost (got ${host})`);
    }
    if (await canBindToHost(host)) {
      return host;
    }
    throw new Error(`gateway bind=custom requested ${host} but it is not bindable on this host`);
  }

  if (mode === 'auto') {
    if (isContainerEnvironment()) {
      return '0.0.0.0';
    }
    if (await canBindToHost('127.0.0.1')) {
      return '127.0.0.1';
    }
    return '0.0.0.0';
  }

  return '0.0.0.0';
}

export async function resolveGatewayListenHosts(bindHost: string): Promise<string[]> {
  if (bindHost !== '127.0.0.1') {
    return [bindHost];
  }
  if (await canBindToHost('::1')) {
    return [bindHost, '::1'];
  }
  return [bindHost];
}

export function isNetworkAccessibleBindHost(bindHost: string): boolean {
  return !isLoopbackHost(bindHost);
}

export function resolveGatewayEffectiveHost(
  cfg: Config,
  overrides?: { bind?: GatewayBindMode; host?: string },
): string {
  if (overrides?.host?.trim()) {
    const mapped = bindModeFromHostOverride(overrides.host);
    return resolveGatewayBindHostSync({
      bindMode: mapped.bind,
      customBindHost: mapped.customBindHost,
    });
  }
  const bindMode = resolveGatewayBindMode(cfg, overrides?.bind);
  const customBindHost = resolveGatewayCustomBindHost(cfg);
  return resolveGatewayBindHostSync({ bindMode, customBindHost });
}
