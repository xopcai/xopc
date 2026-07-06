import type { Hono } from 'hono';

import { registerAgentStreamRoutes } from './agent-stream.js';
import { registerSessionsRoutes } from './sessions.js';
import { registerStatusRoutes } from './status.js';
import { registerMemoryRoutes } from './memory.js';
import { registerProjectsRoutes } from './projects.js';
import type { AuthenticatedRouteDeps } from './deps.js';
import {
  mountAppLazyRoutePrefixes,
  registerAuthenticatedLazyRouteFallback,
} from './lazy-fallback.js';

export function registerCoreAuthenticatedRoutes(
  authenticated: Hono,
  deps: AuthenticatedRouteDeps,
): void {
  registerStatusRoutes(authenticated, deps);
  registerAgentStreamRoutes(authenticated, deps);
  registerSessionsRoutes(authenticated, deps);
  registerMemoryRoutes(authenticated, deps);
  registerProjectsRoutes(authenticated, deps);
}

export function registerAuthenticatedRoutes(app: Hono, authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  registerCoreAuthenticatedRoutes(authenticated, deps);
  registerAuthenticatedLazyRouteFallback(authenticated, deps);
  mountAppLazyRoutePrefixes(app, { service: deps.service, deps });
}

export type { AuthenticatedRouteDeps } from './deps.js';
