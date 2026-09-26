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
    id: 'agent-plugins',
    match: path => path === '/api/extensions/inspect' || path === '/api/extensions/install'
      || startsWithAny(path, ['/api/extensions/agent-plugins']),
    load: async () => {
      const { registerAgentPluginRoutes } = await import('./agent-plugins.js');
      return { register: registerAgentPluginRoutes };
    },
  },
  {
    id: 'local-app-capabilities',
    match: path => /^\/api\/local-app-capabilities\/[^/]+(?:\/[^/]+\/invocations)?$/.test(path),
    load: async () => {
      const { registerLocalAppCapabilityRoutes } = await import('./local-app-capabilities.js');
      return { register: registerLocalAppCapabilityRoutes };
    },
  },
  {
    id: 'capability-operations',
    match: path => startsWithAny(path, ['/api/capabilities/operations']),
    load: async () => {
      const { registerCapabilityOperationRoutes } = await import('./capability-operations.js');
      return { register: registerCapabilityOperationRoutes };
    },
  },
  {
    id: 'endpoint-compatibility',
    match: (path) => path === '/api/endpoint-tools/compatibility',
    load: async () => {
      const { registerEndpointCompatibilityRoutes } = await import('./endpoint-compatibility.js');
      return { register: registerEndpointCompatibilityRoutes };
    },
  },
  {
    id: 'imports',
    match: (path) => startsWithAny(path, ['/api/imports']),
    load: async () => {
      const { registerImportRoutes } = await import('./imports.js');
      return { register: registerImportRoutes };
    },
  },
  {
    id: 'project-understanding',
    match: (path) => /^\/api\/projects\/[^/]+\/understanding$/.test(path),
    load: async () => {
      const { registerProjectUnderstandingRoutes } = await import('./project-understanding.js');
      return { register: registerProjectUnderstandingRoutes };
    },
  },
  {
    id: 'browser-session',
    match: (path) => path === '/api/browser-session',
    load: async () => {
      const { registerBrowserSessionRoutes } = await import('./browser-session.js');
      return { register: registerBrowserSessionRoutes };
    },
  },
  {
    id: 'scenes',
    match: (path) => startsWithAny(path, ['/api/scenes']),
    load: async () => {
      const { registerSceneRoutes } = await import('./scenes.js');
      return { register: registerSceneRoutes };
    },
  },
  {
    id: 'runtime-tools',
    match: (path) => startsWithAny(path, ['/api/runtime-tools']),
    load: async () => {
      const { registerRuntimeToolsRoutes } = await import('./runtime-tools.js');
      return { register: registerRuntimeToolsRoutes };
    },
  },
  {
    id: 'media',
    match: (path) => startsWithAny(path, ['/api/media']),
    load: async () => {
      const { registerMediaRoutes } = await import('./media.js');
      return { register: registerMediaRoutes };
    },
  },
  {
    id: 'files',
    match: (path) => startsWithAny(path, ['/api/files']),
    load: async () => {
      const { registerFilesRoutes } = await import('./files.js');
      return { register: registerFilesRoutes };
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
    match: (path) => path === '/api/browser/playwright/install/stream'
      || path === '/api/browser/playwright/install/cancel',
    load: async () => {
      const { registerBrowserInstallRoutes } = await import('./browser-install.js');
      return { register: registerBrowserInstallRoutes };
    },
  },
  {
    id: 'browser-automations',
    match: (path) => startsWithAny(path, ['/api/browser/automations', '/api/browser/automation-runs']),
    load: async () => {
      const { registerBrowserAutomationRoutes } = await import('./browser-automations.js');
      return { register: registerBrowserAutomationRoutes };
    },
  },
  {
    id: 'browser',
    // `browser-install` above already matched the SSE install streams; this
    // catches the remaining Browser Control v2 setup handlers.
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
    match: (path) => startsWithAny(path, ['/api/doctor', '/api/migrations']),
    load: async () => {
      const { registerDoctorRoutes } = await import('./doctor.js');
      const { registerMigrationRoutes } = await import('./migrations.js');
      return {
        register: (authenticated, deps) => {
          registerDoctorRoutes(authenticated, deps);
          registerMigrationRoutes(authenticated, deps);
        },
      };
    },
  },
  {
    id: 'support',
    match: (path) => startsWithAny(path, ['/api/support']),
    load: async () => {
      const { registerSupportRoutes } = await import('./support.js');
      return { register: registerSupportRoutes };
    },
  },
  {
    id: 'image-generation',
    match: (path) =>
      startsWithAny(path, ['/api/image-generation']) ||
      /^\/api\/agents\/[^/]+\/image-generation(?:\/setup)?$/.test(path),
    load: async () => {
      const { registerModelsRoutes } = await import('./models.js');
      return { register: registerModelsRoutes };
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
    id: 'global-defaults',
    match: (path) => startsWithAny(path, ['/api/global-defaults']),
    load: async () => {
      const { registerGlobalDefaultsRoutes } = await import('./global-defaults.js');
      return { register: registerGlobalDefaultsRoutes };
    },
  },
  {
    id: 'auth-registry-extensions',
    match: (path) =>
      startsWithAny(path, [
        '/api/auth',
        '/api/registry',
        '/api/extensions',
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
      startsWithAny(path, ['/api/models', '/api/models-json', '/api/providers', '/api/capabilities/readiness']),
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
    match: (path) =>
      startsWithAny(path, [
        '/api/commands',
        '/api/review',
        '/api/skills',
        '/api/chat/skills',
        '/api/chat/workspace-trust',
        '/api/chat/capabilities',
      ]),
    load: async () => {
      const { registerCommandsSkillsRoutes } = await import('./commands-skills.js');
      return { register: registerCommandsSkillsRoutes };
    },
  },
  {
    id: 'automations',
    match: (path) => startsWithAny(path, ['/api/automations', '/api/automation-runs', '/api/automation-events', '/api/automation-deliveries']),
    load: async () => {
      const { registerAutomationRoutes } = await import('../../../automations/api/routes.js');
      return { register: registerAutomationRoutes };
    },
  },
  {
    id: 'discussions',
    match: (path) => path === '/api/discussions' || path.startsWith('/api/discussions/') || path === '/api/discussion-capture/settings',
    load: async () => {
      const { registerDiscussionRoutes } = await import('./discussions.js');
      return { register: registerDiscussionRoutes };
    },
  },
  {
    id: 'notes',
    match: (path) =>
      startsWithAny(path, ['/api/notes'])
      && !/^\/api\/notes\/[^/]+\/hosted-publications(?:\/.*)?$/.test(path),
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
    id: 'usage',
    match: (path) => startsWithAny(path, ['/api/usage']),
    load: async () => {
      const { registerUsageRoutes } = await import('./usage.js');
      return { register: registerUsageRoutes };
    },
  },
  {
    id: 'shares',
    match: (path) =>
      startsWithAny(path, ['/api/shares', '/api/hosted-publications']) ||
      /^\/api\/notes\/[^/]+\/hosted-publications(?:\/.*)?$/.test(path) ||
      /^\/api\/sessions\/[^/]+\/(?:share-preview|shares|hosted-shares)(?:\/.*)?$/.test(path),
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
    id: 'user-model-refresh',
    match: (pathname) => pathname === '/api/user-model/refresh' || pathname.startsWith('/api/user-model/refresh/'),
    load: async () => {
      const { registerUserModelRefreshRoutes } = await import('./user-model-refresh.js');
      return { register: registerUserModelRefreshRoutes };
    },
  },
  {
    id: 'user-model',
    match: (path) => startsWithAny(path, [
      '/api/user-model', '/api/knowledge-memory', '/api/memory-maintenance', '/api/turns',
    ]),
    load: async () => {
      const { registerUserModelRoutes } = await import('./user-model.js');
      return { register: registerUserModelRoutes };
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
    id: 'capabilities',
    match: (path) => startsWithAny(path, ['/api/capabilities']),
    load: async () => {
      const { registerCapabilityRoutes } = await import('./capabilities.js');
      return { register: registerCapabilityRoutes };
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
];

export function findAuthenticatedLazyRouteBundle(path: string): AuthenticatedLazyRouteBundle | undefined {
  return AUTHENTICATED_LAZY_ROUTE_BUNDLES.find((bundle) => bundle.match(path));
}
