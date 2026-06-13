import { createMiddleware } from 'hono/factory';
import type { Context } from 'hono';

import { createGatewayRouteLogger, logRouteError } from '../lib/route-logger.js';

const log = createGatewayRouteLogger('Routes');

export function routeErrorMiddleware() {
  return createMiddleware(async (c, next) => {
    try {
      await next();
    } catch (err) {
      logRouteError(log, c, err, 'gateway.http.route');
      throw err;
    }
  });
}

export function registerGatewayOnError(app: { onError: (handler: (err: Error, c: Context) => Response | Promise<Response>) => void }) {
  app.onError((err, c) => {
    logRouteError(log, c, err, 'gateway.http.unhandled');
    return c.json(
      {
        error: 'Internal Server Error',
        message: err instanceof Error ? err.message : 'Unknown error',
      },
      500,
    );
  });
}
