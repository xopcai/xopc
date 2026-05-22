import type { Hono } from 'hono';

import { registerAgentStreamRoutes } from './agent-stream.js';
import { registerAgentsRoutes } from './agents.js';
import { registerAuthRegistryExtensionsRoutes } from './auth-registry-extensions.js';
import { registerChannelRoutes } from './channels.js';
import { registerCommandsSkillsRoutes } from './commands-skills.js';
import { registerConfigRoutes } from './config.js';
import { registerDoctorRoutes } from './doctor.js';
import { registerCronRoutes } from './cron.js';
import { registerDreamingRoutes } from './dreaming.js';
import { registerGoalsRoutes } from './goals.js';
import type { AuthenticatedRouteDeps } from './deps.js';
import { registerExtensionGatewayRoutes } from './extension-gateway.js';
import { registerHostFsRoutes } from './host-fs.js';
import { registerLogsRoutes } from './logs.js';
import { registerModelsRoutes } from './models.js';
import { registerSessionsRoutes } from './sessions.js';
import { registerStatusRoutes } from './status.js';
import { registerSharePublicRoutes, registerShareRoutes } from './shares.js';
import { registerTunnelPublicRoutes, registerTunnelRoutes } from './tunnel.js';
import { registerUpdateRoutes } from './update.js';
import { registerVoiceRoutes } from './voice.js';
import { registerMcpRoutes } from './mcp.js';
import { registerWorkspaceRoutes } from './workspace.js';

export function registerAuthenticatedRoutes(app: Hono, authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  registerStatusRoutes(authenticated, deps);
  registerWorkspaceRoutes(authenticated, deps);
  registerHostFsRoutes(authenticated, deps);
  registerAgentStreamRoutes(authenticated, deps);
  registerChannelRoutes(authenticated, deps);
  registerConfigRoutes(authenticated, deps);
  registerDoctorRoutes(authenticated, deps);
  registerDreamingRoutes(authenticated, deps);
  registerAgentsRoutes(authenticated, deps);
  registerAuthRegistryExtensionsRoutes(authenticated, deps);
  registerModelsRoutes(authenticated, deps);
  registerCommandsSkillsRoutes(authenticated, deps);
  registerCronRoutes(authenticated, deps);
  registerSessionsRoutes(authenticated, deps);
  registerGoalsRoutes(authenticated, deps);
  registerLogsRoutes(authenticated, deps);
  registerSharePublicRoutes(app, deps.service);
  registerShareRoutes(authenticated, deps);
  registerTunnelPublicRoutes(app, deps.service);
  registerTunnelRoutes(authenticated, deps);
  registerExtensionGatewayRoutes(authenticated, deps);
  registerUpdateRoutes(authenticated, deps);
  registerVoiceRoutes(authenticated, deps);
  registerMcpRoutes(authenticated, deps);
}

export type { AuthenticatedRouteDeps } from './deps.js';
