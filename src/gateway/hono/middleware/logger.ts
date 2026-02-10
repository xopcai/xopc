import { createMiddleware } from 'hono/factory';
import { createLogger } from '../../../utils/logger.js';

const log = createLogger('Hono:Request');

export function logger() {
  return createMiddleware(async (c, next) => {
    const start = Date.now();
    
    await next();
    
    const duration = Date.now() - start;
    
    log.info({
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      duration: `${duration}ms`,
    }, 'HTTP request');
  });
}
