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
  // Providers - hot reload
  { prefix: 'providers', kind: 'hot', description: 'Provider API keys, base URLs' },
  
  // Agent defaults - hot reload
  { prefix: 'agents.defaults.model', kind: 'hot', description: 'Model configuration' },
  { prefix: 'agents.defaults.maxTokens', kind: 'hot', description: 'Max tokens' },
  { prefix: 'agents.defaults.temperature', kind: 'hot', description: 'Temperature' },
  { prefix: 'agents.defaults.maxToolIterations', kind: 'hot', description: 'Max tool iterations' },
  { prefix: 'agents.defaults.compaction', kind: 'hot', description: 'Compaction settings' },
  { prefix: 'agents.defaults.pruning', kind: 'hot', description: 'Pruning settings' },
  { prefix: 'agents.defaults.workspace', kind: 'none', description: 'Workspace path - no runtime effect' },
  
  // Gateway - restart required
  { prefix: 'gateway.host', kind: 'restart', description: 'Host address' },
  { prefix: 'gateway.port', kind: 'restart', description: 'Port number' },
  { prefix: 'gateway.auth', kind: 'restart', description: 'Authentication settings' },
  { prefix: 'gateway.cors', kind: 'restart', description: 'CORS settings' },
  { prefix: 'gateway.enableHotReload', kind: 'hot', description: 'Hot reload toggle' },
  
  // Channels - hot reload
  { prefix: 'channels.telegram', kind: 'hot', description: 'Telegram settings' },
  { prefix: 'channels.whatsapp', kind: 'hot', description: 'WhatsApp settings' },
  
  // Cron - hot reload
  { prefix: 'cron', kind: 'hot', description: 'Scheduled tasks' },
  
  // Heartbeat - hot reload
  { prefix: 'heartbeat', kind: 'hot', description: 'Heartbeat settings' },
  
  // Web search - hot reload
  { prefix: 'webSearch', kind: 'hot', description: 'Web search settings' },
  { prefix: 'webTools', kind: 'hot', description: 'Web tools settings' },
  
  // Plugins - restart required
  { prefix: 'plugins', kind: 'restart', description: 'Plugin configuration' },
  
  // Tools - hot reload (for tool-specific settings)
  { prefix: 'tools', kind: 'hot', description: 'Tools configuration' },
];

// Map for O(1) prefix lookup
const rulesMap = new Map(BASE_RELOAD_RULES.map(r => [r.prefix, r]));

/**
 * Find matching rule for a config path
 */
export function matchReloadRule(path: string): ReloadRule | null {
  // Check exact match first
  if (rulesMap.has(path)) {
    return rulesMap.get(path)!;
  }
  // Then check prefix match
  for (const [prefix, rule] of rulesMap) {
    if (path.startsWith(`${prefix}.`)) {
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

/**
 * Get all hot-reloadable config paths
 */
export function getHotReloadablePaths(): string[] {
  return BASE_RELOAD_RULES
    .filter(r => r.kind === 'hot')
    .map(r => r.prefix);
}

/**
 * Get config paths that require restart
 */
export function getRestartRequiredPaths(): string[] {
  return BASE_RELOAD_RULES
    .filter(r => r.kind === 'restart')
    .map(r => r.prefix);
}
