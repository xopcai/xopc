import { createMiddleware } from 'hono/factory';
import { createLogger } from '../../../utils/logger.js';

const log = createLogger('Hono:Auth');

export function auth(token?: string) {
  return createMiddleware(async (c, next) => {
    // If no token configured, allow all
    if (!token) {
      return next();
    }

    const authHeader = c.req.header('authorization');
    if (!authHeader) {
      log.warn('Missing authorization header');
      return c.json({ error: 'Unauthorized' }, 401);
    }

    // Support "Bearer token" format
    const parts = authHeader.split(' ');
    const providedToken = parts.length === 2 && parts[0].toLowerCase() === 'bearer'
      ? parts[1]
      : authHeader;

    if (providedToken !== token) {
      log.warn('Invalid token');
      return c.json({ error: 'Unauthorized' }, 401);
    }

    await next();
  });
}
