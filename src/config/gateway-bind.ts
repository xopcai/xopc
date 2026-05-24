import { existsSync } from 'node:fs';
import net from 'node:net';

import { getTailnetIPv4Sync } from '../infra/tailscale.js';
import type { Config } from '../config/schema.js';
import type { GatewayBindMode } from '../config/schema.js';
import { isLoopbackHost } from '../gateway/host.js';

export type { GatewayBindMode };

export function resolveGatewayBindMode(
  cfg: Config,
  bindOverride?: GatewayBindMode,
): GatewayBindMode {
  if (bindOverride) {
    return bindOverride;
  }
  return cfg.gateway?.bind ?? defaultGatewayBindMode();
}

export function resolveGatewayCustomBindHost(cfg: Config, override?: string): string | undefined {
  const fromOverride = override?.trim();
  if (fromOverride) {
    return fromOverride;
  }
  return cfg.gateway?.customBindHost?.trim() || undefined;
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

/** Resolve primary Tailscale tailnet IPv4 (100.x) when available. */
export function pickPrimaryTailnetIPv4(): string | undefined {
  return getTailnetIPv4Sync();
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
  overrides?: { bind?: GatewayBindMode },
): string {
  const bindMode = resolveGatewayBindMode(cfg, overrides?.bind);
  const customBindHost = resolveGatewayCustomBindHost(cfg);
  return resolveGatewayBindHostSync({ bindMode, customBindHost });
}

/** Loopback URL hostname when connecting to the gateway from the same machine. */
export function resolveGatewayLocalClientHost(cfg: Config): string {
  const bindHost = resolveGatewayEffectiveHost(cfg);
  return bindHost === '0.0.0.0' || bindHost === '::' ? '127.0.0.1' : bindHost;
}
