import type { Hono } from 'hono';

import type { GatewayService } from '../../service.js';
import type { AuthenticatedRouteDeps } from './deps.js';

export type AuthenticatedLazyRouteBundle = {
  id: string;
  match: (path: string) => boolean;
  load: () => Promise<{ register: (authenticated: Hono, deps: AuthenticatedRouteDeps) => void }>;
};

export type AppLazyRouteBundle = {
  id: string;
  prefixes: readonly string[];
  match: (path: string) => boolean;
  load: () => Promise<{
    registerOnApp: (app: Hono, service: GatewayService) => void;
  }>;
};

function startsWithAny(path: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

export const AUTHENTICATED_LAZY_ROUTE_BUNDLES: readonly AuthenticatedLazyRouteBundle[] = [
  {
    id: 'workspace',
    match: (path) => startsWithAny(path, ['/api/workspace']),
    load: async () => {
      const { registerWorkspaceRoutes } = await import('./workspace.js');
      return { register: registerWorkspaceRoutes };
    },
  },
  {
    id: 'host-fs',
    match: (path) => startsWithAny(path, ['/api/host/fs']),
    load: async () => {
      const { registerHostFsRoutes } = await import('./host-fs.js');
      return { register: registerHostFsRoutes };
    },
  },
  {
    id: 'channels',
    match: (path) => startsWithAny(path, ['/api/channels']),
    load: async () => {
      const { registerChannelRoutes } = await import('./channels.js');
      return { register: registerChannelRoutes };
    },
  },
  {
    id: 'browser-install',
    match: (path) =>
      path === '/api/browser/playwright/install/stream' ||
      path === '/api/browser/cloakbrowser/install/stream',
    load: async () => {
      const { registerBrowserInstallRoutes } = await import('./browser-install.js');
      return { register: registerBrowserInstallRoutes };
    },
  },
  {
    id: 'config',
    match: (path) =>
      startsWithAny(path, ['/api/config', '/api/browser', '/api/heartbeat/trigger']),
    load: async () => {
      const { registerConfigRoutes } = await import('./config.js');
      return { register: registerConfigRoutes };
    },
  },
  {
    id: 'doctor',
    match: (path) => startsWithAny(path, ['/api/doctor']),
    load: async () => {
      const { registerDoctorRoutes } = await import('./doctor.js');
      return { register: registerDoctorRoutes };
    },
  },
  {
    id: 'dreaming',
    match: (path) => startsWithAny(path, ['/api/dreaming']),
    load: async () => {
      const { registerDreamingRoutes } = await import('./dreaming.js');
      return { register: registerDreamingRoutes };
    },
  },
  {
    id: 'agents',
    match: (path) => startsWithAny(path, ['/api/agents', '/api/voice/models']),
    load: async () => {
      const { registerAgentsRoutes } = await import('./agents.js');
      return { register: registerAgentsRoutes };
    },
  },
  {
    id: 'auth-registry-extensions',
    match: (path) =>
      startsWithAny(path, [
        '/api/auth',
        '/api/registry',
        '/api/extensions',
        '/api/context',
        '/api/marketplace',
      ]),
    load: async () => {
      const { registerAuthRegistryExtensionsRoutes } = await import('./auth-registry-extensions.js');
      return { register: registerAuthRegistryExtensionsRoutes };
    },
  },
  {
    id: 'models',
    match: (path) => startsWithAny(path, ['/api/models', '/api/providers', '/api/image']),
    load: async () => {
      const { registerModelsRoutes } = await import('./models.js');
      return { register: registerModelsRoutes };
    },
  },
  {
    id: 'commands-skills',
    match: (path) => startsWithAny(path, ['/api/commands', '/api/skills']),
    load: async () => {
      const { registerCommandsSkillsRoutes } = await import('./commands-skills.js');
      return { register: registerCommandsSkillsRoutes };
    },
  },
  {
    id: 'cron',
    match: (path) => startsWithAny(path, ['/api/cron']),
    load: async () => {
      const { registerCronRoutes } = await import('./cron.js');
      return { register: registerCronRoutes };
    },
  },
  {
    id: 'goals',
    match: (path) => startsWithAny(path, ['/api/goals']),
    load: async () => {
      const { registerGoalsRoutes } = await import('./goals.js');
      return { register: registerGoalsRoutes };
    },
  },
  {
    id: 'logs',
    match: (path) => startsWithAny(path, ['/api/logs']),
    load: async () => {
      const { registerLogsRoutes } = await import('./logs.js');
      return { register: registerLogsRoutes };
    },
  },
  {
    id: 'shares',
    match: (path) => startsWithAny(path, ['/api/shares']),
    load: async () => {
      const { registerShareRoutes } = await import('./shares.js');
      return { register: registerShareRoutes };
    },
  },
  {
    id: 'tunnel',
    match: (path) => startsWithAny(path, ['/api/tunnel']),
    load: async () => {
      const { registerTunnelRoutes } = await import('./tunnel.js');
      return { register: registerTunnelRoutes };
    },
  },
  {
    id: 'exposure',
    match: (path) => startsWithAny(path, ['/api/exposure']),
    load: async () => {
      const { registerExposureRoutes } = await import('./exposure.js');
      return { register: registerExposureRoutes };
    },
  },
  {
    id: 'extension-gateway',
    match: (path) => startsWithAny(path, ['/api/gateway']),
    load: async () => {
      const { registerExtensionGatewayRoutes } = await import('./extension-gateway.js');
      return { register: registerExtensionGatewayRoutes };
    },
  },
  {
    id: 'update',
    match: (path) => startsWithAny(path, ['/api/update']),
    load: async () => {
      const { registerUpdateRoutes } = await import('./update.js');
      return { register: registerUpdateRoutes };
    },
  },
  {
    id: 'voice',
    match: (path) => startsWithAny(path, ['/api/voice']) && path !== '/api/voice/models',
    load: async () => {
      const { registerVoiceRoutes } = await import('./voice.js');
      return { register: registerVoiceRoutes };
    },
  },
  {
    id: 'mcp',
    match: (path) => startsWithAny(path, ['/api/mcp']),
    load: async () => {
      const { registerMcpRoutes } = await import('./mcp.js');
      return { register: registerMcpRoutes };
    },
  },
];

export const APP_LAZY_ROUTE_BUNDLES: readonly AppLazyRouteBundle[] = [
  {
    id: 'shares-public',
    prefixes: ['/s'],
    match: (path) => startsWithAny(path, ['/s']),
    load: async () => {
      const { registerSharePublicRoutes } = await import('./shares.js');
      return { registerOnApp: registerSharePublicRoutes };
    },
  },
  {
    id: 'tunnel-public',
    prefixes: [
      '/api/tunnel/pair/ping',
      '/api/tunnel/pair/validate-url',
      '/api/tunnel/exchange-token',
    ],
    match: (path) =>
      path === '/api/tunnel/exchange-token' ||
      path === '/api/tunnel/pair/ping' ||
      path === '/api/tunnel/pair/validate-url',
    load: async () => {
      const { registerTunnelPublicRoutes } = await import('./tunnel.js');
      return { registerOnApp: registerTunnelPublicRoutes };
    },
  },
];

export function findAuthenticatedLazyRouteBundle(path: string): AuthenticatedLazyRouteBundle | undefined {
  return AUTHENTICATED_LAZY_ROUTE_BUNDLES.find((bundle) => bundle.match(path));
}
