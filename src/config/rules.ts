/**
 * Configuration reload rules
 * 
 * Defines how different config paths are handled:
 * - hot: Apply changes immediately without restart
 * - restart: Require gateway restart
 * - none: Ignore changes (no action needed)
 */

export type ReloadKind = 'hot' | 'restart' | 'none';

export interface ReloadRule {
  prefix: string;
  kind: ReloadKind;
  description?: string;
}

export interface ReloadPlan {
  changedPaths: string[];
  hotPaths: string[];
  restartPaths: string[];
  noopPaths: string[];
  requiresRestart: boolean;
  requiresHotReload: boolean;
}

/**
 * Base reload rules for config paths
 */
export const BASE_RELOAD_RULES: ReloadRule[] = [
  // Models config - hot reload
  { prefix: 'models.providers', kind: 'hot', description: 'Model provider API keys, base URLs' },
  { prefix: 'models.mode', kind: 'hot', description: 'Model merge mode' },
  
  { prefix: 'agents.list', kind: 'hot', description: 'Agent overrides' },
  { prefix: 'agents.defaults', kind: 'hot', description: 'Global agent defaults' },
  { prefix: 'agents.default', kind: 'hot', description: 'Default agent id' },
  
  // Gateway - restart required
  { prefix: 'gateway.bind', kind: 'restart', description: 'Gateway bind mode' },
  { prefix: 'gateway.customBindHost', kind: 'restart', description: 'Gateway custom bind host' },
  { prefix: 'gateway.port', kind: 'restart', description: 'Port number' },
  { prefix: 'gateway.mode', kind: 'restart', description: 'Gateway local/remote CLI mode' },
  { prefix: 'gateway.remote', kind: 'restart', description: 'Remote gateway CLI target' },
  { prefix: 'gateway.tailscale', kind: 'restart', description: 'Tailscale Serve/Funnel exposure' },
  { prefix: 'gateway.tls', kind: 'restart', description: 'Gateway native TLS' },
  { prefix: 'gateway.auth', kind: 'restart', description: 'Authentication settings' },
  { prefix: 'gateway.security', kind: 'restart', description: 'Gateway security policy' },
  { prefix: 'gateway.corsOrigins', kind: 'hot', description: 'CORS allowlist' },
  { prefix: 'gateway.trustedProxies', kind: 'restart', description: 'Trusted reverse proxy CIDRs' },
  {
    prefix: 'gateway.allowRealIpFallback',
    kind: 'restart',
    description: 'Trusted-proxy X-Real-IP fallback',
  },
  {
    prefix: 'gateway.dangerouslyAllowHostHeaderOriginFallback',
    kind: 'restart',
    description: 'Host-header origin fallback',
  },
  { prefix: 'gateway.channelConnectDeferMode', kind: 'restart', description: 'Channel connect defer mode' },
  { prefix: 'gateway.channelConnectDeferIds', kind: 'restart', description: 'Explicit channel connect defer list' },
  { prefix: 'gateway.channelConnectDeferSkipIds', kind: 'restart', description: 'Channel connect defer skip list' },
  { prefix: 'gateway.share', kind: 'restart', description: 'File share policy' },
  { prefix: 'gateway.siteShare', kind: 'restart', description: 'Site share policy' },
  {
    prefix: 'gateway.skillsStoreBaseUrl',
    kind: 'restart',
    description: 'Skills marketplace API base URL',
  },
  { prefix: 'gateway.enableHotReload', kind: 'hot', description: 'Hot reload toggle' },
  
  // Channels - hot reload (channel-specific prefixes are registered by channel plugins)
  { prefix: 'channels', kind: 'hot', description: 'Any channel subtree (e.g. future extensions)' },
  
  // Heartbeat lives under gateway.heartbeat in config JSON (not top-level `heartbeat`)
  { prefix: 'gateway.heartbeat', kind: 'hot', description: 'Heartbeat settings' },
  
  // Web search - hot reload
  { prefix: 'webSearch', kind: 'hot', description: 'Web search settings' },
  { prefix: 'webTools', kind: 'hot', description: 'Web tools settings' },
  
  // Extension list toggles — still require process restart to load/unload modules
  {
    prefix: 'extensions.enabled',
    kind: 'restart',
    description: 'Extension enable list (requires restart)',
  },
  {
    prefix: 'extensions.disabled',
    kind: 'restart',
    description: 'Extension disable list (requires restart)',
  },
  // Extension instance config — hot-reloaded via extension registerReload handlers
  {
    prefix: 'extensions',
    kind: 'hot',
    description: 'Extension configuration (hot-reloaded via extension handlers)',
  },
  
  // Tools - hot reload (for tool-specific settings)
  { prefix: 'tools', kind: 'hot', description: 'Tools configuration' },

  // MCP servers - hot reload (dispose and reconnect runtimes)
  { prefix: 'mcp', kind: 'hot', description: 'MCP server definitions and idle TTL' },

  // Tunnel E2E TLS — restart (local HTTPS terminator port)
  { prefix: 'tunnel', kind: 'hot', description: 'Tunnel broker and auto-start settings' },
];

function getChannelReloadRules(): ReloadRule[] {
  return [];
}

function mergedReloadRules(): ReloadRule[] {
  return [...BASE_RELOAD_RULES, ...getChannelReloadRules()];
}

/**
 * Find matching rule for a config path
 */
export function matchReloadRule(path: string): ReloadRule | null {
  const merged = mergedReloadRules();
  const exact = merged.find((r) => r.prefix === path);
  if (exact) return exact;
  const sorted = [...merged].sort((a, b) => b.prefix.length - a.prefix.length);
  for (const rule of sorted) {
    if (path === rule.prefix || path.startsWith(`${rule.prefix}.`)) {
      return rule;
    }
  }
  return null;
}

/**
 * Build reload plan from changed paths
 */
export function buildReloadPlan(changedPaths: string[]): ReloadPlan {
  const plan: ReloadPlan = {
    changedPaths,
    hotPaths: [],
    restartPaths: [],
    noopPaths: [],
    requiresRestart: false,
    requiresHotReload: false,
  };

  for (const path of changedPaths) {
    const rule = matchReloadRule(path);
    
    if (!rule) {
      // No rule matched - default to restart for safety
      plan.restartPaths.push(path);
      plan.requiresRestart = true;
      continue;
    }

    switch (rule.kind) {
      case 'hot':
        plan.hotPaths.push(path);
        plan.requiresHotReload = true;
        break;
      case 'restart':
        plan.restartPaths.push(path);
        plan.requiresRestart = true;
        break;
      case 'none':
        plan.noopPaths.push(path);
        break;
    }
  }

  return plan;
}
