import type { MiddlewareHandler } from 'hono';

import type { GatewayService } from '../../service.js';

export interface AuthenticatedRouteDeps {
  service: GatewayService;
  strictRateLimitMiddleware: MiddlewareHandler;
  chatRateLimitMiddleware: MiddlewareHandler;
  xopcCloudPollRateLimitMiddleware: MiddlewareHandler;
  channelRateLimitMiddleware?: MiddlewareHandler;
}
