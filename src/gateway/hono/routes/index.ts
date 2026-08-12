import type { Hono } from 'hono';

import { registerActivityRoutes } from './activity.js';
import { registerAgentStreamRoutes } from './agent-stream.js';
import { registerSessionsRoutes } from './sessions.js';
import { registerStatusRoutes } from './status.js';
import { registerMemoryRoutes } from './memory.js';
import { registerProjectsRoutes } from './projects.js';
import { registerProjectSkillRoutes } from './project-skills.js';
import { registerSearchRoutes } from './search.js';
import { registerMobileRoutes } from './mobile.js';
import { registerTaskOutcomeRoutes } from './task-outcomes.js';
import { registerInteractionStateRoutes } from './interaction-state.js';
import { registerComposerHistoryRoutes } from './composer-history.js';
import { registerLocalAppsRoutes } from './local-apps.js';
import { registerWorkDiscoveryRoutes } from './work-discovery.js';
import { registerProactiveRoutes } from './proactive.js';
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
  registerActivityRoutes(authenticated, deps);
  registerProjectsRoutes(authenticated, deps);
  registerProjectSkillRoutes(authenticated, deps);
  registerLocalAppsRoutes(authenticated, deps);
  registerWorkDiscoveryRoutes(authenticated, deps);
  registerProactiveRoutes(authenticated, deps);
  registerSearchRoutes(authenticated, deps);
  registerMobileRoutes(authenticated, deps);
  registerTaskOutcomeRoutes(authenticated, deps);
  registerInteractionStateRoutes(authenticated, deps);
  registerComposerHistoryRoutes(authenticated, deps);
}

export function registerAuthenticatedRoutes(app: Hono, authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  registerCoreAuthenticatedRoutes(authenticated, deps);
  registerAuthenticatedLazyRouteFallback(authenticated, deps);
  mountAppLazyRoutePrefixes(app, { service: deps.service, deps });
}

export type { AuthenticatedRouteDeps } from './deps.js';
