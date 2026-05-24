import crypto from 'crypto';
import type { GatewayAuthConfig } from '../config/schema.js';
import { safeEqualSecret } from './security/secret-equal.js';

/**
 * Resolved gateway authentication configuration.
 *
 * Supports four modes:
 * - `none`: no authentication (local dev only)
 * - `token`: Bearer token authentication (default)
 * - `password`: password-based authentication (for simpler setups)
 * - `trusted-proxy`: reverse proxy terminates auth and forwards user identity headers
 */
export interface ResolvedGatewayAuth {
  mode: 'none' | 'token' | 'password' | 'trusted-proxy';
  token?: string;
  password?: string;
  trustedProxy?: GatewayAuthConfig['trustedProxy'];
}

/**
 * Resolve gateway authentication configuration.
 * Priority: env vars > config > defaults
 */
export function resolveGatewayAuth(params: {
  authConfig?: GatewayAuthConfig | null;
  env?: NodeJS.ProcessEnv;
}): ResolvedGatewayAuth {
  const env = params.env ?? process.env;
  const config: GatewayAuthConfig = params.authConfig ?? { mode: 'token' };

  const envMode = env.XOPC_GATEWAY_AUTH_MODE;
  const envToken = env.XOPC_GATEWAY_TOKEN;
  const envPassword = env.XOPC_GATEWAY_PASSWORD;

  let mode: ResolvedGatewayAuth['mode'] = 'token';
  if (
    envMode === 'none' ||
    envMode === 'token' ||
    envMode === 'password' ||
    envMode === 'trusted-proxy'
  ) {
    mode = envMode;
  } else if (
    config.mode === 'none' ||
    config.mode === 'password' ||
    config.mode === 'trusted-proxy'
  ) {
    mode = config.mode;
  }

  const hasToken = Boolean(envToken || config.token);
  const hasPassword = Boolean(envPassword || config.password);
  if (hasToken && hasPassword) {
    throw new Error(
      'Invalid config: both gateway.auth.token and gateway.auth.password are set. ' +
      'Choose one authentication mode: "token" (Bearer header) or "password".',
    );
  }

  if (mode === 'trusted-proxy' && hasToken) {
    throw new Error(
      'Invalid config: gateway.auth.mode is trusted-proxy but a shared token is also configured. ' +
      'Remove gateway.auth.token / XOPC_GATEWAY_TOKEN because trusted-proxy and token auth are mutually exclusive.',
    );
  }

  if (mode === 'trusted-proxy') {
    return {
      mode: 'trusted-proxy',
      trustedProxy: config.trustedProxy,
    };
  }

  let token: string | undefined;
  if (mode === 'token') {
    if (envToken) {
      token = envToken;
    } else if (config.token) {
      token = config.token;
    } else {
      token = crypto.randomBytes(24).toString('hex');
    }
  }

  let password: string | undefined;
  if (mode === 'password') {
    if (envPassword) {
      password = envPassword;
    } else if (config.password) {
      password = config.password;
    }
  }

  return { mode, token, password };
}

/**
 * Assert that gateway auth is properly configured.
 */
export function assertGatewayAuthConfigured(auth: ResolvedGatewayAuth): void {
  if (auth.mode === 'token' && !auth.token) {
    throw new Error(
      'Gateway auth mode is token, but no token was configured. ' +
      'Set gateway.auth.token in config or XOPC_GATEWAY_TOKEN environment variable.',
    );
  }
  if (auth.mode === 'password' && !auth.password) {
    throw new Error(
      'Gateway auth mode is password, but no password was configured. ' +
      'Set gateway.auth.password in config or XOPC_GATEWAY_PASSWORD environment variable.',
    );
  }
  if (auth.mode === 'trusted-proxy') {
    if (!auth.trustedProxy) {
      throw new Error(
        'Gateway auth mode is trusted-proxy, but no trustedProxy config was provided ' +
        '(set gateway.auth.trustedProxy).',
      );
    }
    if (!auth.trustedProxy.userHeader || auth.trustedProxy.userHeader.trim() === '') {
      throw new Error(
        'Gateway auth mode is trusted-proxy, but trustedProxy.userHeader is empty ' +
        '(set gateway.auth.trustedProxy.userHeader).',
      );
    }
  }
}

/**
 * Validate a credential against configured auth using constant-time comparison.
 *
 * Works for both token and password modes — the caller extracts the credential
 * from the appropriate transport (header, query param, etc.).
 */
export function validateToken(auth: ResolvedGatewayAuth, providedCredential?: string | null): boolean {
  if (auth.mode === 'none' || auth.mode === 'trusted-proxy') {
    return true;
  }

  if (!providedCredential) {
    return false;
  }

  if (auth.mode === 'password') {
    if (!auth.password) return false;
    return safeEqualSecret(auth.password, providedCredential);
  }

  if (!auth.token) return false;
  return safeEqualSecret(auth.token, providedCredential);
}

/**
 * Extract token from request headers.
 * Supports: Authorization: Bearer <token>, X-Api-Key: <token>
 */
export function extractToken(headers?: Record<string, string | string[] | undefined>): string | undefined {
  if (!headers) return undefined;

  const authHeader = headers.authorization;
  if (authHeader) {
    const value = Array.isArray(authHeader) ? authHeader[0] : authHeader;
    if (value?.startsWith('Bearer ')) {
      return value.slice(7);
    }
  }

  const apiKey = headers['x-api-key'];
  if (apiKey) {
    return Array.isArray(apiKey) ? apiKey[0] : apiKey;
  }

  return undefined;
}
