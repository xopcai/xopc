import { createMiddleware } from 'hono/factory';
import { createLogger } from '../../../utils/logger.js';

const log = createLogger('Hono:Auth');

export interface AuthConfig {
  token?: string;
}

/**
 * Validate token from header or query parameter
 */
function validateToken(providedToken: string | undefined, expectedToken: string): boolean {
  if (!providedToken) return false;
  return providedToken === expectedToken;
}

/**
 * Extract token from Authorization header
 * Supports: "Bearer <token>", "<token>"
 */
function extractTokenFromHeader(authHeader: string | null): string | null {
  if (!authHeader) return null;

  const parts = authHeader.split(' ');
  if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') {
    return parts[1];
  }
  return authHeader;
}

/**
 * Extract token from query parameter
 */
function extractTokenFromQuery(url: string): string | null {
  const parsed = new URL(url);
  return parsed.searchParams.get('token');
}

/**
 * Create auth middleware for HTTP routes
 */
export function auth(config?: AuthConfig) {
  const { token } = config || {};

  return createMiddleware(async (c, next) => {
    // If no token configured, allow all
    if (!token) {
      return next();
    }

    // Try header first, then query param
    const authHeader = extractTokenFromHeader(c.req.header('authorization'));
    const queryToken = extractTokenFromQuery(c.req.url);

    const providedToken = authHeader || queryToken;

    if (!providedToken) {
      log.warn('Missing authorization');
      return c.json({ error: 'Unauthorized', message: 'Missing authentication token' }, 401);
    }

    if (!validateToken(providedToken, token)) {
      log.warn('Invalid token');
      return c.json({ error: 'Unauthorized', message: 'Invalid authentication token' }, 401);
    }

    await next();
  });
}

export interface WebSocketAuthResult {
  valid: boolean;
  error?: string;
}

/**
 * Validate WebSocket connection token
 */
export function validateWebSocketAuth(
  url: URL,
  authHeader: string | null,
  expectedToken?: string
): WebSocketAuthResult {
  // If no token configured, allow all
  if (!expectedToken) {
    return { valid: true };
  }

  // Extract token from query param or header
  const queryToken = url.searchParams.get('token');
  const headerToken = extractTokenFromHeader(authHeader);

  const providedToken = queryToken || headerToken;

  if (!providedToken) {
    log.warn('WebSocket missing authorization');
    return { valid: false, error: 'Missing authentication token' };
  }

  if (!validateToken(providedToken, expectedToken)) {
    log.warn('WebSocket invalid token');
    return { valid: false, error: 'Invalid authentication token' };
  }

  return { valid: true };
}
