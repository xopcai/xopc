import type { Hono } from 'hono';

import { MCP_BRIDGE_PATH } from '../../../mcp/connection-grants.js';
import {
  MCP_OAUTH_AS_METADATA_PATH,
  MCP_OAUTH_BASE_PATH,
  MCP_RESOURCE_METADATA_PATH,
  MCP_ROOT_RESOURCE_METADATA_PATH,
  REMOTE_MCP_PATH,
} from '../../../mcp/remote-config.js';

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
    id: 'task-retry',
    match: path => /^\/api\/tasks\/[^/]+\/retry$/.test(path),
    load: async () => {
      const { registerTaskRetryRoutes } = await import('./task-retry.js');
      return { register: registerTaskRetryRoutes };
    },
  },
  {
    id: 'space',
    match: path => /^\/api\/spaces\/(?:items(?:\/[^/]+(?:\/(?:restore|purge|workbook(?:-actions)?|versions(?:\/[^/]+\/content)?))?)?|(?:artifacts|deliveries)\/[^/]+)$/.test(path),
    load: async () => {
      const { registerSpaceRoutes } = await import('./space.js');
      return { register: registerSpaceRoutes };
    },
  },
  {
    id: 'user-avatar',
    match: path => path === '/api/user-context/avatar',
    load: async () => {
      const { registerUserAvatarRoutes } = await import('./user-avatar.js');
      return { register: registerUserAvatarRoutes };
    },
  },
  {
    id: 'self-config',
    match: path => path === '/api/self-config/inspect'
      || path === '/api/self-config/changes'
      || /^\/api\/self-config\/changes\/[^/]+\/rollback$/.test(path)
      || /^\/api\/setup\/(?:models|web_search|voice|channels|computer)$/.test(path),
    load: async () => {
      const { registerSelfConfigRoutes } = await import('./self-config.js');
      return { register: registerSelfConfigRoutes };
    },
  },
  {
    id: 'location-sharing',
    match: path => /^\/api\/user-context\/environment\/location-shares(?:\/[^/]+(?:\/samples)?)?$/.test(path),
    load: async () => {
      const { registerLocationSharingRoutes } = await import('./location-sharing.js');
      return { register: registerLocationSharingRoutes };
    },
  },
  {
    id: 'endpoint-environment',
    match: path => /^\/api\/user-context\/environment(?:\/(?:reports|heartbeats|endpoints\/[^/]+))?$/.test(path),
    load: async () => {
      const { registerEndpointEnvironmentRoutes } = await import('./endpoint-environment.js');
      return { register: registerEndpointEnvironmentRoutes };
    },
  },
  {
    id: 'phone',
    match: path => startsWithAny(path, ['/api/phone']),
    load: async () => {
      const { registerPhoneRoutes } = await import('./phone.js');
      return { register: registerPhoneRoutes };
    },
  },
  {
    id: 'session-input-control',
    match: path => /^\/api\/sessions\/[^/]+\/input-control$/.test(path),
    load: async () => {
      const { registerSessionInputControlRoutes } = await import('./session-input-control.js');
      return { register: registerSessionInputControlRoutes };
    },
  },
  {
    id: 'next-turn-suggestions',
    match: path => /^\/api\/sessions\/[^/]+\/(?:next-turn-suggestion|next-turn-suggestion-feedback)$/.test(path),
    load: async () => {
      const { registerNextTurnSuggestionRoutes } = await import('./next-turn-suggestions.js');
      return { register: registerNextTurnSuggestionRoutes };
    },
  },
  {
    id: 'personal-agent',
    match: path => startsWithAny(path, ['/api/personal-agent']),
    load: async () => {
      const { registerPersonalAgentRoutes } = await import('./personal-agent.js');
      return { register: registerPersonalAgentRoutes };
    },
  },
  {
    id: 'proactive-rsi',
    match: path => path === '/api/proactive/inbox'
      || /^\/api\/proactive\/inbox\/[^/]+\/act$/.test(path)
      || path === '/api/proactive/digests'
      || path === '/api/proactive/digests/flush'
      || path === '/api/proactive/subscriptions'
      || /^\/api\/proactive\/subscriptions\/[^/]+$/.test(path)
      || path === '/api/rsi/candidates'
      || /^\/api\/rsi\/candidates\/[^/]+\/(?:adopt|reject|rollback)$/.test(path),
    load: async () => {
      const { registerProactiveRsiRoutes } = await import('./proactive-rsi.js');
      return { register: registerProactiveRsiRoutes };
    },
  },
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
    id: 'local-app-development',
    match: path => /^\/api\/local-apps\/[^/]+\/development-conversation$/.test(path),
    load: async () => {
      const { registerLocalAppDevelopmentRoutes } = await import('./local-app-development.js');
      return { register: registerLocalAppDevelopmentRoutes };
    },
  },
  {
    id: 'local-app-capabilities',
    match: path => /^\/api\/local-app-capabilities\/[^/]+(?:\/[^/]+\/invocations|\/runs\/[^/]+\/events)?$/.test(path),
    load: async () => {
      const { registerLocalAppCapabilityRoutes } = await import('./local-app-capabilities.js');
      return { register: registerLocalAppCapabilityRoutes };
    },
  },
  {
    id: 'local-app-previews',
    match: path => /^\/api\/local-app-previews\/(?:[^/]+\/sessions|sessions\/[^/]+(?:\/requests)?)$/.test(path),
    load: async () => {
      const { registerLocalAppPreviewRoutes } = await import('./local-app-previews.js');
      return { register: registerLocalAppPreviewRoutes };
    },
  },
  {
    id: 'mcp-bridge',
    match: path => path === MCP_BRIDGE_PATH,
    load: async () => {
      const { registerMcpBridgeRoutes } = await import('./mcp-bridge.js');
      return { register: registerMcpBridgeRoutes };
    },
  },
  {
    id: 'mcp-server-admin',
    match: path => path === '/api/mcp-server/overview'
      || path === '/api/mcp-server/config'
      || path === '/api/mcp-server/audit'
      || path === '/api/mcp-server/grants/local'
      || /^\/api\/mcp-server\/grants\/local\/[^/]+$/.test(path)
      || path === '/api/mcp-server/grants/remote'
      || /^\/api\/mcp-server\/grants\/remote\/[^/]+$/.test(path)
      || /^\/api\/mcp-server\/oauth-clients\/[^/]+$/.test(path),
    load: async () => {
      const { registerMcpServerAdminRoutes } = await import('./mcp-server-admin.js');
      return { register: registerMcpServerAdminRoutes };
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
    id: 'desktop-host',
    match: path => path === '/api/desktop-host/compatibility' || path === '/api/desktop-host/pairing-setups' || path === '/api/desktop-host/status'
      || ['/api/desktop-host/observation', '/api/desktop-host/screen', '/api/desktop-host/execution', '/api/desktop-host/operations'].includes(path) || /^\/api\/desktop-host\/operations\/[^/]+(?:\/review)?$/.test(path) || /^\/api\/desktop-host\/devices\/[^/]+\/(?:observation|screen|execution)$/.test(path),
    load: async () => {
      const { registerDesktopHostRoutes } = await import('./desktop-host.js');
      return { register: registerDesktopHostRoutes };
    },
  },
  {
    id: 'device-authorizations',
    match: path => /^\/api\/endpoint-tools\/target-authorizations(?:\/[^/]+)?$/.test(path),
    load: async () => {
      const { registerDeviceAuthorizationRoutes } = await import('./device-authorizations.js');
      return { register: registerDeviceAuthorizationRoutes };
    },
  },
  {
    id: 'device-settings',
    match: path => /^\/api\/endpoint-tools\/devices\/[^/]+$/.test(path) && path !== '/api/endpoint-tools/devices/revoke',
    load: async () => {
      const { registerDeviceSettingsRoutes } = await import('./endpoint-tools.js');
      return { register: registerDeviceSettingsRoutes };
    },
  },
  {
    id: 'device-hosts',
    match: path => path === '/api/endpoint-tools/hosts/enrollment',
    load: async () => {
      const { registerDeviceHostRoutes } = await import('./device-hosts.js');
      return { register: registerDeviceHostRoutes };
    },
  },
  {
    id: 'device-connections',
    match: path => /^\/api\/endpoint-tools\/device-connections(?:\/(?:folders|chat|capabilities))?$/.test(path),
    load: async () => {
      const { registerDeviceConnectionRoutes } = await import('./device-connections.js');
      return { register: registerDeviceConnectionRoutes };
    },
  },
  {
    id: 'device-targets',
    match: path => /^\/api\/endpoint-tools\/targets\/[^/]+$/.test(path),
    load: async () => {
      const { registerDeviceTargetRoutes } = await import('./device-targets.js');
      return { register: registerDeviceTargetRoutes };
    },
  },
  {
    id: 'device-providers',
    match: path => /^\/api\/endpoint-tools\/(?:providers(?:\/admission)?|(?:provider-operations|interactions)\/[^/]+|(?:artifact-transfers|delegations)(?:\/[^/]+)?|invocations\/[^/]+\/artifact)$/.test(path),
    load: async () => {
      const { registerDeviceProviderRoutes } = await import('./device-providers.js');
      return { register: registerDeviceProviderRoutes };
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
    id: 'runtime-tools',
    match: (path) => startsWithAny(path, ['/api/runtime-tools']),
    load: async () => {
      const { registerRuntimeToolsRoutes } = await import('./runtime-tools.js');
      return { register: registerRuntimeToolsRoutes };
    },
  },
  {
    id: 'music-generation',
    match: (path) => /^\/api\/music-generation\/settings(?:\/credentials\/[^/]+)?$/.test(path)
      || /^\/api\/music-generation\/sessions\/[^/]+\/jobs(?:\/[0-9a-f]{64}\/audio)?$/.test(path),
    load: async () => {
      const { registerMusicGenerationRoutes } = await import('./music-generation.js');
      return { register: registerMusicGenerationRoutes };
    },
  },
  {
    id: 'image-generation-jobs',
    match: (path) => /^\/api\/image-generation\/sessions\/[^/]+\/jobs(?:\/[0-9a-f]{64}\/images\/[0-9]+)?$/.test(path),
    load: async () => {
      const { registerImageGenerationRoutes } = await import('./image-generation.js');
      return { register: registerImageGenerationRoutes };
    },
  },
  {
    id: 'video-generation',
    match: (path) => path === '/api/video-generation/settings' || /^\/api\/video-generation\/sessions\/[^/]+\/jobs(?:\/confirm-draft|\/[^/]+\/video)?$/.test(path),
    load: async () => {
      const { registerVideoGenerationRoutes } = await import('./video-generation.js');
      return { register: registerVideoGenerationRoutes };
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
    id: 'browser-setup',
    match: path => path === '/api/browser/setup',
    load: async () => {
      const { registerBrowserSetupRoutes } = await import('./browser-setup.js');
      return { register: registerBrowserSetupRoutes };
    },
  },
  {
    id: 'browser',
    // `browser-install` above already matched the SSE install streams; this
    // catches browser control and live preview availability.
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
    id: 'mobile-model-settings',
    match: path => path === '/api/mobile/model-settings',
    load: async () => {
      const { registerMobileModelSettingsRoutes } = await import('./mobile-model-settings.js');
      return { register: registerMobileModelSettingsRoutes };
    },
  },
  {
    id: 'models',
    // Includes /api/models/setup/:providerId and its preview/apply actions.
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
    match: (path) => path === '/api/discussions' || path.startsWith('/api/discussions/') || path === '/api/discussion-capture/settings' || path === '/api/discussion-capture/preflight',
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
    id: 'logs',
    match: (path) => startsWithAny(path, ['/api/logs']),
    load: async () => {
      const { registerLogsRoutes } = await import('./logs.js');
      return { register: registerLogsRoutes };
    },
  },
  {
    id: 'observability',
    match: (path) => startsWithAny(path, ['/api/observability']),
    load: async () => {
      const { registerObservabilityRoutes } = await import('./observability.js');
      return { register: registerObservabilityRoutes };
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
      '/api/user-model', '/api/knowledge-memory', '/api/memory-maintenance', '/api/memory-learning', '/api/turns',
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
    match: (path) => path === '/api/tui/startup-resources' || path === '/api/tui/diff' || path === '/api/tui/manage' || path === '/api/tui/side'
      || /^\/api\/tui\/capabilities\/(?:skills|mcp|plugins)$/.test(path)
      || /^\/api\/tui\/sessions\/[^/]+\/(?:policy|search|jobs(?:\/[^/]+(?:\/(?:stop|stdin|resize))?)?|subagents(?:\/[^/]+(?:\/(?:stop|steer|resume|transcript))?)?)$/.test(path),
    load: async () => {
      const { registerTuiRoutes } = await import('./tui.js');
      return { register: registerTuiRoutes };
    },
  },
  {
    id: 'mcp',
    match: (path) => path === '/api/mcp/servers' || /^\/api\/mcp\/servers\/[^/]+$/.test(path) || path === '/api/mcp/drafts'
      || /^\/api\/mcp\/drafts\/[^/]+(?:\/(?:probe|commit|tools|auth(?:\/redirect)?))?$/.test(path)
      || /^\/api\/mcp\/servers\/[^/]+\/(tools|probe|auth)$/.test(path)
      || /^\/api\/mcp\/auth\/[^/]+(?:\/redirect)?$/.test(path)
      || /^\/api\/mcp\/setup\/[^/]+$/.test(path)
      || /^\/api\/mcp\/setup\/conversations\/[^/]+$/.test(path),
    load: async () => {
      const { registerMcpRoutes } = await import('./mcp.js');
      return { register: registerMcpRoutes };
    },
  },
  {
    id: 'screenshot-ai',
    match: (path) => path === '/api/screenshot/analyze',
    load: async () => {
      const { registerScreenshotAiRoutes } = await import('./screenshot-ai.js');
      return { register: registerScreenshotAiRoutes };
    },
  },
];

export const APP_LAZY_ROUTE_BUNDLES: readonly AppLazyRouteBundle[] = [
  {
    id: 'mcp-remote',
    prefixes: [
      REMOTE_MCP_PATH,
      MCP_RESOURCE_METADATA_PATH,
      MCP_ROOT_RESOURCE_METADATA_PATH,
      MCP_OAUTH_AS_METADATA_PATH,
      MCP_OAUTH_BASE_PATH,
    ],
    match: path => path === REMOTE_MCP_PATH
      || path === MCP_RESOURCE_METADATA_PATH
      || path === MCP_ROOT_RESOURCE_METADATA_PATH
      || path === MCP_OAUTH_AS_METADATA_PATH
      || path === `${MCP_OAUTH_BASE_PATH}/jwks`
      || path === `${MCP_OAUTH_BASE_PATH}/register`
      || path === `${MCP_OAUTH_BASE_PATH}/authorize`
      || path === `${MCP_OAUTH_BASE_PATH}/token`
      || path === `${MCP_OAUTH_BASE_PATH}/revoke`,
    load: async () => {
      const { registerRemoteMcpRoutes } = await import('./mcp-remote.js');
      return { registerOnApp: registerRemoteMcpRoutes };
    },
  },
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
