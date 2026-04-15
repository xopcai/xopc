import type { MiddlewareHandler } from 'hono';

import type { GatewayService } from '../../service.js';
import type { SSEHandlerConfig } from '../sse.js';

export interface AuthenticatedRouteDeps {
  service: GatewayService;
  strictRateLimitMiddleware: MiddlewareHandler;
  sseConfig: SSEHandlerConfig;
}
