import crypto from 'crypto';
import type { GatewayAuthConfig } from '../config/schema.js';
import { safeEqualSecret } from './security/secret-equal.js';

/**
 * Resolved gateway authentication configuration.
 *
 * Supports three modes:
 * - `none`: no authentication (local dev only)
 * - `token`: Bearer token authentication (default)
 * - `password`: password-based authentication (for simpler setups)
 */
export interface ResolvedGatewayAuth {
  mode: 'none' | 'token' | 'password';
  token?: string;
  password?: string;
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

  // Environment variables take precedence
  const envMode = env.XOPC_GATEWAY_AUTH_MODE;
  const envToken = env.XOPC_GATEWAY_TOKEN;
  const envPassword = env.XOPC_GATEWAY_PASSWORD;

  // Resolve mode
  let mode: ResolvedGatewayAuth['mode'] = 'token';
  if (envMode === 'none' || envMode === 'token' || envMode === 'password') {
    mode = envMode;
  } else if (config.mode === 'none' || config.mode === 'password') {
    mode = config.mode;
  }

  // Ambiguity detection: reject conflicting credential types
  const hasToken = Boolean(envToken || config.token);
  const hasPassword = Boolean(envPassword || config.password);
  if (hasToken && hasPassword) {
    throw new Error(
      'Invalid config: both gateway.auth.token and gateway.auth.password are set. ' +
      'Choose one authentication mode: "token" (Bearer header) or "password".',
    );
  }

  // Resolve token
  let token: string | undefined;
  if (mode === 'token') {
    if (envToken) {
      token = envToken;
    } else if (config.token) {
      token = config.token;
    } else {
      // Auto-generate token if not provided
      token = crypto.randomBytes(24).toString('hex');
    }
  }

  // Resolve password
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
}

/**
 * Constant-time string comparison to prevent timing attacks.
 *
 * Uses `crypto.timingSafeEqual` with padding so both buffers always have
 * the same byte length. The actual length is checked separately.
 *
 * @deprecated Use `safeEqualSecret` from `./security/secret-equal.js` directly.
 */
export function safeCompare(a: string, b: string): boolean {
  return safeEqualSecret(a, b);
}

/**
 * Validate a credential against configured auth using constant-time comparison.
 *
 * Works for both token and password modes — the caller extracts the credential
 * from the appropriate transport (header, query param, etc.).
 */
export function validateToken(auth: ResolvedGatewayAuth, providedCredential?: string | null): boolean {
  if (auth.mode === 'none') {
    return true;
  }

  if (!providedCredential) {
    return false;
  }

  if (auth.mode === 'password') {
    if (!auth.password) return false;
    return safeEqualSecret(auth.password, providedCredential);
  }

  // Default: token mode
  if (!auth.token) return false;
  return safeEqualSecret(auth.token, providedCredential);
}

/**
 * Extract token from request headers.
 * Supports: Authorization: Bearer <token>, X-Api-Key: <token>
 */
export function extractToken(headers?: Record<string, string | string[] | undefined>): string | undefined {
  if (!headers) return undefined;

  // Authorization: Bearer <token>
  const authHeader = headers.authorization;
  if (authHeader) {
    const value = Array.isArray(authHeader) ? authHeader[0] : authHeader;
    if (value?.startsWith('Bearer ')) {
      return value.slice(7);
    }
  }

  // X-Api-Key: <token>
  const apiKey = headers['x-api-key'];
  if (apiKey) {
    return Array.isArray(apiKey) ? apiKey[0] : apiKey;
  }

  return undefined;
}
