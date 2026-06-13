import { fetch as undiciFetch } from 'undici';
import { resolveGatewayLocalClientHost } from '../config/gateway-bind.js';
import type { Config } from '../config/schema.js';
import { loadConfig } from '../config/loader.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('Mcp:GatewayClient');

function resolveGatewayTokenFromConfig(cfg: Config): string | undefined {
  const fromConfig = cfg.gateway?.auth?.token?.trim();
  if (fromConfig) {
    return fromConfig;
  }
  return process.env.XOPC_GATEWAY_TOKEN?.trim() || undefined;
}

export type GatewayHttpClientOptions = {
  baseUrl: string;
  token?: string;
};

export class GatewayHttpClient {
  constructor(private readonly opts: GatewayHttpClientOptions) {}

  private headers(extra?: Record<string, string>): Record<string, string> {
    const h: Record<string, string> = { Accept: 'application/json', ...extra };
    if (this.opts.token) {
      h.Authorization = `Bearer ${this.opts.token}`;
    }
    return h;
  }

  async getJson<T>(path: string): Promise<T> {
    const res = await undiciFetch(`${this.opts.baseUrl}${path}`, {
      headers: this.headers(),
    });
    if (!res.ok) {
      const em = `Gateway GET ${path} failed: ${res.status}`;
      log.warn({ phase: 'mcp.gateway.http', method: 'GET', path, status: res.status }, em);
      throw new Error(em);
    }
    const body = (await res.json()) as { ok?: boolean; payload?: T } | T;
    if (body && typeof body === 'object' && 'payload' in body) {
      return (body as { payload: T }).payload;
    }
    return body as T;
  }

  async postJson<T>(path: string, data: unknown): Promise<T> {
    const res = await undiciFetch(`${this.opts.baseUrl}${path}`, {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const em = `Gateway POST ${path} failed: ${res.status}`;
      log.warn({ phase: 'mcp.gateway.http', method: 'POST', path, status: res.status }, em);
      throw new Error(em);
    }
    const body = (await res.json()) as { ok?: boolean; payload?: T } | T;
    if (body && typeof body === 'object' && 'payload' in body) {
      return (body as { payload: T }).payload;
    }
    return body as T;
  }
}

export function resolveGatewayHttpBaseUrl(config: Config, override?: string): string {
  if (override?.trim()) {
    return override.replace(/\/$/, '');
  }
  const host = resolveGatewayLocalClientHost(config);
  const port = config.gateway?.port ?? 18790;
  return `http://${host}:${port}`;
}

export function createGatewayHttpClientFromConfig(params: {
  config?: Config;
  gatewayUrl?: string;
  gatewayToken?: string;
}): GatewayHttpClient {
  const cfg = params.config ?? loadConfig();
  const token = params.gatewayToken ?? resolveGatewayTokenFromConfig(cfg) ?? undefined;
  return new GatewayHttpClient({
    baseUrl: resolveGatewayHttpBaseUrl(cfg, params.gatewayUrl),
    token,
  });
}
