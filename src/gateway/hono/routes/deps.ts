import type { MiddlewareHandler } from 'hono';

import type { GatewayService } from '../../service.js';

export interface AuthenticatedRouteDeps {
  service: GatewayService;
  strictRateLimitMiddleware: MiddlewareHandler;
  chatRateLimitMiddleware: MiddlewareHandler;
  mediaRateLimitMiddleware?: MiddlewareHandler;
  taskRateLimitMiddleware?: MiddlewareHandler;
  xopcCloudPollRateLimitMiddleware: MiddlewareHandler;
  channelRateLimitMiddleware?: MiddlewareHandler;
}
