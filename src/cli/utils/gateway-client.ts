/**
 * Gateway API client — CLI-side HTTP client for gateway REST routes.
 */

import { loadConfig } from '../../config/index.js';
import { resolveConfigPath } from '../../config/paths.js';
import { resolveGatewayEffectiveHost } from '../../config/gateway-bind.js';
import { assertSecureGatewayHttpUrl } from '../../gateway/ws-security.js';
import {
  createGatewayCredential,
  gatewayCredentialAuthorization,
  type GatewayCredential,
} from '../../gateway/credential.js';
import { createLogger } from '../../utils/logger.js';
import type { GatewayClientOptions } from './gateway-client-options.js';

export type { GatewayClientOptions } from './gateway-client-options.js';
export { addGatewayClientOptions, parseGatewayClientOptions } from './gateway-client-options.js';

const log = createLogger('GatewayClient');

export interface GatewayCallResult<T = unknown> {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
  durationMs: number;
}

export function resolveGatewayUrl(opts?: { url?: string; configPath?: string }): string {
  if (opts?.url) {
    const normalized = opts.url.replace(/\/+$/, '');
    assertSecureGatewayHttpUrl(normalized);
    return normalized;
  }

  const envUrl = process.env.XOPC_GATEWAY_URL?.trim();
  if (envUrl) {
    const normalized = envUrl.replace(/\/+$/, '');
    assertSecureGatewayHttpUrl(normalized);
    return normalized;
  }

  try {
    const configPath = opts?.configPath ?? resolveConfigPath();
    const config = loadConfig(configPath);
    if (config.gateway?.mode === 'remote' && config.gateway.remote?.url?.trim()) {
      const normalized = config.gateway.remote.url.trim().replace(/\/+$/, '');
      assertSecureGatewayHttpUrl(normalized);
      return normalized;
    }
    const host = resolveGatewayEffectiveHost(config);
    const port = config?.gateway?.port ?? 18790;
    const displayHost = host === '0.0.0.0' ? '127.0.0.1' : host;
    const url = `http://${displayHost}:${port}`;
    assertSecureGatewayHttpUrl(url);
    return url;
  } catch {
    return 'http://127.0.0.1:18790';
  }
}

export function resolveGatewayCredential(opts?: {
  token?: string;
  passwordEnv?: string;
  credential?: GatewayCredential;
  configPath?: string;
}): GatewayCredential | undefined {
  if (opts?.credential) return opts.credential;
  if (opts?.token && opts.passwordEnv) {
    throw new Error('Use either --token or --password-env, not both.');
  }
  if (opts?.token) return createGatewayCredential('token', opts.token);
  if (opts?.passwordEnv) {
    return createGatewayCredential('password', process.env[opts.passwordEnv]);
  }

  const envToken = process.env.XOPC_GATEWAY_TOKEN;
  if (envToken) return createGatewayCredential('token', envToken);

  try {
    const configPath = opts?.configPath ?? resolveConfigPath();
    const config = loadConfig(configPath);
    if (config.gateway?.mode === 'remote') {
      const remoteToken = config.gateway.remote?.token?.trim();
      if (remoteToken) return createGatewayCredential('token', remoteToken);
    }
    const auth = config.gateway?.auth;
    return auth?.mode === 'password'
      ? createGatewayCredential('password', auth.password)
      : createGatewayCredential('token', auth?.token);
  } catch {
    return undefined;
  }
}

export async function callGatewayApi<T = unknown>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  opts?: GatewayClientOptions,
  body?: unknown,
): Promise<GatewayCallResult<T>> {
  const baseUrl = resolveGatewayUrl(opts);
  const credential = resolveGatewayCredential(opts);
  const timeoutMs = opts?.timeoutMs ?? 10_000;
  const url = `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;

  const headers: Record<string, string> = {
    Accept: 'application/json',
  };
  const authorization = gatewayCredentialAuthorization(credential);
  if (authorization) {
    headers.Authorization = authorization;
  }
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  const startedAt = Date.now();

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    clearTimeout(timer);
    const durationMs = Date.now() - startedAt;

    if (!response.ok) {
      let errorMessage: string;
      try {
        const errorBody = (await response.json()) as {
          error?: string;
          message?: string;
        };
        errorMessage = errorBody.error || errorBody.message || response.statusText;
      } catch {
        errorMessage = response.statusText;
      }

      log.debug({ url, status: response.status, durationMs }, `Gateway call failed: ${errorMessage}`);
      return {
        ok: false,
        status: response.status,
        error: errorMessage,
        durationMs,
      };
    }

    const data = (await response.json()) as T;
    log.debug({ url, status: response.status, durationMs }, 'Gateway call succeeded');
    return { ok: true, status: response.status, data, durationMs };
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const isAbort = err instanceof Error && err.name === 'AbortError';
    const errorMessage = isAbort
      ? `Request timed out after ${timeoutMs}ms`
      : err instanceof Error
        ? err.message
        : String(err);

    log.debug({ url, err, durationMs }, `Gateway call error: ${errorMessage}`);
    return { ok: false, status: 0, error: errorMessage, durationMs };
  }
}
