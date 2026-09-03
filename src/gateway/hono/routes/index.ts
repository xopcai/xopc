import type { Hono } from 'hono';

import { registerActivityRoutes } from './activity.js';
import { registerAgentStreamRoutes } from './agent-stream.js';
import { registerDiscussionRoutes } from './discussions.js';
import { registerSessionsRoutes } from './sessions.js';
import { registerExecutionEnvironmentRoutes } from './execution-environments.js';
import { registerSideChatRoutes } from './side-chats.js';
import { registerStatusRoutes } from './status.js';
import { registerProjectsRoutes } from './projects.js';
import { registerProjectSkillRoutes } from './project-skills.js';
import { registerSearchRoutes } from './search.js';
import { registerDevicePushRoutes } from './device-push.js';
import { registerNotificationRoutes } from './notifications.js';
import { registerInteractionStateRoutes } from './interaction-state.js';
import { registerComposerHistoryRoutes } from './composer-history.js';
import { registerEndpointToolRoutes } from './endpoint-tools.js';
import { registerRealtimeRoutes } from './realtime.js';
import { registerDeviceRoutes } from './devices.js';
import { registerLocalAppsRoutes } from './local-apps.js';
import { registerWorkDiscoveryRoutes } from './work-discovery.js';
import { registerUnderstandingSourceRoutes } from './understanding-sources.js';
import { registerTaskRoutes } from './tasks.js';
import { registerProactiveRoutes } from './proactive.js';
import { registerMobilePrivacyRoutes } from './mobile-privacy.js';
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
  registerMobilePrivacyRoutes(authenticated, deps);
  registerAgentStreamRoutes(authenticated, deps);
  registerSessionsRoutes(authenticated, deps);
  registerExecutionEnvironmentRoutes(authenticated, deps);
  registerSideChatRoutes(authenticated, deps);
  registerActivityRoutes(authenticated, deps);
  registerDiscussionRoutes(authenticated, deps);
  registerProjectsRoutes(authenticated, deps);
  registerProjectSkillRoutes(authenticated, deps);
  registerLocalAppsRoutes(authenticated, deps);
  registerWorkDiscoveryRoutes(authenticated, deps);
  registerUnderstandingSourceRoutes(authenticated, deps);
  registerTaskRoutes(authenticated, deps);
  registerProactiveRoutes(authenticated, deps);
  registerSearchRoutes(authenticated, deps);
  registerDevicePushRoutes(authenticated);
  registerNotificationRoutes(authenticated, deps);
  registerInteractionStateRoutes(authenticated, deps);
  registerComposerHistoryRoutes(authenticated, deps);
  registerEndpointToolRoutes(authenticated, deps);
  registerRealtimeRoutes(authenticated, deps);
  registerDeviceRoutes(authenticated, deps);
}

export function registerAuthenticatedRoutes(app: Hono, authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  registerCoreAuthenticatedRoutes(authenticated, deps);
  registerAuthenticatedLazyRouteFallback(authenticated, deps);
  mountAppLazyRoutePrefixes(app, { service: deps.service, deps });
}

export type { AuthenticatedRouteDeps } from './deps.js';
