import { fetch as undiciFetch } from 'undici';
import { CapabilityErrorCodeSchema, type CapabilityErrorCode } from '@xopcai/gateway-contract';
import { resolveGatewayLocalClientHost } from '../config/gateway-bind.js';
import type { Config } from '../config/schema.js';
import { loadConfig } from '../config/loader.js';
import {
  createGatewayCredential,
  gatewayCredentialAuthorization,
  type GatewayCredential,
} from '../gateway/credential.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('Mcp:GatewayClient');

export class GatewayHttpError extends Error {
  constructor(readonly status: number, readonly code?: CapabilityErrorCode, readonly operationId?: string) {
    super(`Gateway request failed (${status})`);
  }
}

async function responseError(res: Awaited<ReturnType<typeof undiciFetch>>): Promise<GatewayHttpError> {
  const body = await res.json().catch(() => null) as { code?: unknown; operationId?: unknown } | null;
  const code = CapabilityErrorCodeSchema.safeParse(body?.code);
  return new GatewayHttpError(res.status, code.success ? code.data : undefined,
    typeof body?.operationId === 'string' && body.operationId.length <= 200 ? body.operationId : undefined);
}

function resolveGatewayCredentialFromConfig(cfg: Config): GatewayCredential | undefined {
  const auth = cfg.gateway?.auth;
  if (auth?.mode === 'password') {
    return createGatewayCredential('password', auth.password);
  }
  if (auth?.mode === 'token') {
    return createGatewayCredential('token', auth.token ?? process.env.XOPC_GATEWAY_TOKEN);
  }
  return undefined;
}

export type GatewayHttpClientOptions = {
  baseUrl: string;
  credential?: GatewayCredential;
};

export class GatewayHttpClient {
  constructor(private readonly opts: GatewayHttpClientOptions) {}

  private headers(extra?: Record<string, string>): Record<string, string> {
    const h: Record<string, string> = { Accept: 'application/json', ...extra };
    const authorization = gatewayCredentialAuthorization(this.opts.credential);
    if (authorization) {
      h.Authorization = authorization;
    }
    return h;
  }

  async getJson<T>(path: string): Promise<T> {
    const res = await undiciFetch(`${this.opts.baseUrl}${path}`, {
      headers: this.headers(),
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const em = `Gateway GET ${path} failed: ${res.status}`;
      log.warn({ phase: 'mcp.gateway.http', method: 'GET', path, status: res.status }, em);
      throw await responseError(res);
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
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const em = `Gateway POST ${path} failed: ${res.status}`;
      log.warn({ phase: 'mcp.gateway.http', method: 'POST', path, status: res.status }, em);
      throw await responseError(res);
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
  gatewayCredential?: GatewayCredential;
}): GatewayHttpClient {
  const cfg = params.config ?? loadConfig();
  const credential = params.gatewayCredential ?? resolveGatewayCredentialFromConfig(cfg);
  return new GatewayHttpClient({
    baseUrl: resolveGatewayHttpBaseUrl(cfg, params.gatewayUrl),
    credential,
  });
}
