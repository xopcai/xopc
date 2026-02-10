import type { IncomingMessage } from 'http';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('Gateway:Auth');

export interface AuthConfig {
  token?: string;
}

export function createAuthMiddleware(config: AuthConfig) {
  return function authenticate(req: IncomingMessage): boolean {
    // If no token configured, allow all (development mode)
    if (!config.token) {
      return true;
    }

    const authHeader = req.headers.authorization;
    if (!authHeader) {
      log.warn('Missing authorization header');
      return false;
    }

    // Support "Bearer token" format
    const parts = authHeader.split(' ');
    const token = parts.length === 2 && parts[0].toLowerCase() === 'bearer' 
      ? parts[1] 
      : authHeader;

    if (token !== config.token) {
      log.warn('Invalid token');
      return false;
    }

    return true;
  };
}
