import crypto from 'crypto';
import type { GatewayAuthConfig } from '../config/schema.js';

/**
 * Resolved gateway authentication configuration.
 */
export interface ResolvedGatewayAuth {
  mode: 'none' | 'token';
  token?: string;
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
  const envMode = env.XOPCBOT_GATEWAY_AUTH_MODE;
  const envToken = env.XOPCBOT_GATEWAY_TOKEN;

  // Resolve mode
  let mode: ResolvedGatewayAuth['mode'] = 'token';
  if (envMode === 'none' || envMode === 'token') {
    mode = envMode;
  } else if (config.mode === 'none') {
    mode = 'none';
  }

  // Resolve token
  let token: string | undefined;
  if (envToken) {
    token = envToken;
  } else if (config.token) {
    token = config.token;
  } else if (mode === 'token') {
    // Auto-generate token if not provided
    token = crypto.randomBytes(24).toString('hex');
  }

  return { mode, token };
}

/**
 * Assert that gateway auth is properly configured.
 */
export function assertGatewayAuthConfigured(auth: ResolvedGatewayAuth): void {
  if (auth.mode === 'token' && !auth.token) {
    throw new Error(
      'Gateway auth mode is token, but no token was configured. ' +
      'Set gateway.auth.token in config or XOPCBOT_GATEWAY_TOKEN environment variable.'
    );
  }
}

/**
 * Constant-time string comparison to prevent timing attacks.
 */
export function safeCompare(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'utf8');
  const bBuf = Buffer.from(b, 'utf8');
  
  if (aBuf.length === bBuf.length) {
    return crypto.timingSafeEqual(aBuf, bBuf);
  }
  
  // For different lengths
  let result = aBuf.length ^ bBuf.length;
  const maxLen = Math.max(aBuf.length, bBuf.length);
  for (let i = 0; i < maxLen; i++) {
    result |= (aBuf[i % aBuf.length] ^ bBuf[i % bBuf.length]);
  }
  return result === 0;
}

/**
 * Validate token against configured auth.
 */
export function validateToken(auth: ResolvedGatewayAuth, providedToken?: string | null): boolean {
  if (auth.mode === 'none') {
    return true;
  }
  if (!auth.token || !providedToken) {
    return false;
  }
  return safeCompare(auth.token, providedToken);
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
