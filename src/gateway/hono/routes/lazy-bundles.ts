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
    id: 'media',
    match: (path) => startsWithAny(path, ['/api/media']),
    load: async () => {
      const { registerMediaRoutes } = await import('./media.js');
      return { register: registerMediaRoutes };
    },
  },
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
    id: 'browser',
    // `browser-install` above already matched the SSE install streams; this
    // catches the remaining /api/browser/* handlers (extension, cdp,
    // cloakbrowser doctor/launch/install, playwright doctor/install, cloud).
    match: (path) => startsWithAny(path, ['/api/browser']),
    load: async () => {
      const { registerBrowserRoutes } = await import('./browser.js');
      return { register: registerBrowserRoutes };
    },
  },
  {
    id: 'config',
    match: (path) =>
      startsWithAny(path, [
        '/api/config',
        '/api/heartbeat/trigger',
        // Secret reveal handlers live in config routes but use /api/gateway and
        // /api/tools paths; without these prefixes the extension-gateway bundle
        // matches first and returns 404 (no handler for multi-segment paths).
        '/api/gateway/reveal-auth-secret',
        '/api/tools/web/reveal-search-api-key',
      ]),
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
    match: (path) => startsWithAny(path, ['/api/agents', '/api/user-profile', '/api/voice/models']),
    load: async () => {
      const { registerAgentsRoutes } = await import('./agents.js');
      return { register: registerAgentsRoutes };
    },
  },
  {
    id: 'capability-presets',
    match: (path) => startsWithAny(path, ['/api/capability-presets', '/api/global-defaults']),
    load: async () => {
      const { registerCapabilityPresetsRoutes } = await import('./capability-presets.js');
      const { registerGlobalDefaultsRoutes } = await import('./global-defaults.js');
      return {
        register: (authenticated, deps) => {
          registerCapabilityPresetsRoutes(authenticated, deps);
          registerGlobalDefaultsRoutes(authenticated, deps);
        },
      };
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
    match: (path) =>
      startsWithAny(path, ['/api/models', '/api/models-json', '/api/providers', '/api/image']),
    load: async () => {
      const { registerModelsRoutes } = await import('./models.js');
      return { register: registerModelsRoutes };
    },
  },
  {
    id: 'ai-assist',
    match: (path) => startsWithAny(path, ['/api/ai']),
    load: async () => {
      const { registerAiAssistRoutes } = await import('./ai-assist.js');
      return { register: registerAiAssistRoutes };
    },
  },
  {
    id: 'commands-skills',
    match: (path) => startsWithAny(path, ['/api/commands', '/api/skills', '/api/chat/skills']),
    load: async () => {
      const { registerCommandsSkillsRoutes } = await import('./commands-skills.js');
      return { register: registerCommandsSkillsRoutes };
    },
  },
  {
    id: 'automations',
    match: (path) => startsWithAny(path, ['/api/automations', '/api/automation-runs']),
    load: async () => {
      const { registerAutomationRoutes } = await import('../../../automations/api/routes.js');
      return { register: registerAutomationRoutes };
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
    id: 'notes',
    match: (path) => startsWithAny(path, ['/api/notes']),
    load: async () => {
      const { registerNotesRoutes } = await import('./notes.js');
      return { register: registerNotesRoutes };
    },
  },
  {
    id: 'home',
    match: (path) => startsWithAny(path, ['/api/home']),
    load: async () => {
      const { registerHomeRoutes } = await import('./home.js');
      return { register: registerHomeRoutes };
    },
  },
  {
    id: 'workflows',
    match: (path) => startsWithAny(path, ['/api/workflows']),
    load: async () => {
      const { registerWorkflowRoutes } = await import('./workflows.js');
      return { register: registerWorkflowRoutes };
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
    id: 'site-shares',
    match: (path) => startsWithAny(path, ['/api/site-shares']),
    load: async () => {
      const { registerSiteShareRoutes } = await import('./site-shares.js');
      return { register: registerSiteShareRoutes };
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
    id: 'connectors',
    match: (path) => startsWithAny(path, ['/api/connectors']),
    load: async () => {
      const { registerConnectorRoutes } = await import('./connectors.js');
      return { register: registerConnectorRoutes };
    },
  },
  {
    id: 'tui',
    match: (path) => startsWithAny(path, ['/api/tui']),
    load: async () => {
      const { registerTuiRoutes } = await import('./tui.js');
      return { register: registerTuiRoutes };
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
