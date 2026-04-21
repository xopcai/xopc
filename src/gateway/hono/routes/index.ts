import type { Hono } from 'hono';

import { registerAgentStreamRoutes } from './agent-stream.js';
import { registerAgentsRoutes } from './agents.js';
import { registerAuthRegistryExtensionsRoutes } from './auth-registry-extensions.js';
import { registerChannelRoutes } from './channels.js';
import { registerCommandsSkillsRoutes } from './commands-skills.js';
import { registerConfigRoutes } from './config.js';
import { registerCronRoutes } from './cron.js';
import type { AuthenticatedRouteDeps } from './deps.js';
import { registerExtensionGatewayRoutes } from './extension-gateway.js';
import { registerHostFsRoutes } from './host-fs.js';
import { registerLogsRoutes } from './logs.js';
import { registerModelsRoutes } from './models.js';
import { registerSessionsRoutes } from './sessions.js';
import { registerStatusRoutes } from './status.js';
import { registerWorkspaceRoutes } from './workspace.js';

export function registerAuthenticatedRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  registerStatusRoutes(authenticated, deps);
  registerWorkspaceRoutes(authenticated, deps);
  registerHostFsRoutes(authenticated, deps);
  registerAgentStreamRoutes(authenticated, deps);
  registerChannelRoutes(authenticated, deps);
  registerConfigRoutes(authenticated, deps);
  registerAgentsRoutes(authenticated, deps);
  registerAuthRegistryExtensionsRoutes(authenticated, deps);
  registerModelsRoutes(authenticated, deps);
  registerCommandsSkillsRoutes(authenticated, deps);
  registerCronRoutes(authenticated, deps);
  registerSessionsRoutes(authenticated, deps);
  registerLogsRoutes(authenticated, deps);
  registerExtensionGatewayRoutes(authenticated, deps);
}

export type { AuthenticatedRouteDeps } from './deps.js';
