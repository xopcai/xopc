import type { AgentDefaultsTabId } from '@/features/settings/agents/agent-defaults-tabs';
import type { BrowserTabId } from '@/features/settings/agents/agent-defaults-panels/browser/browser-tabs';
import type { SettingsMode } from '@/stores/settings-mode-store';

/** Agent defaults internal tabs hidden in simple mode. */
export const SIMPLE_MODE_HIDDEN_AGENT_DEFAULTS_TABS = new Set<AgentDefaultsTabId>([
  'runtime',
  'context',
  'memory',
  'system-prompt',
]);

/** Gateway settings tabs hidden in simple mode. */
export const SIMPLE_MODE_HIDDEN_GATEWAY_TABS = new Set([
  'updates',
  'security',
  'advanced',
] as const);

export type GatewaySettingsTabId =
  | 'network'
  | 'access'
  | 'updates'
  | 'security'
  | 'advanced';

/** Browser settings tabs hidden in simple mode. */
export const SIMPLE_MODE_HIDDEN_BROWSER_TABS = new Set<BrowserTabId>([
  'local',
  'cdp',
  'cloud',
]);

export function isAgentDefaultsTabVisibleInMode(
  tab: AgentDefaultsTabId,
  mode: SettingsMode,
): boolean {
  if (mode === 'advanced') {
    return true;
  }
  return !SIMPLE_MODE_HIDDEN_AGENT_DEFAULTS_TABS.has(tab);
}

export function visibleAgentDefaultsTabs(
  tabs: readonly AgentDefaultsTabId[],
  mode: SettingsMode,
): AgentDefaultsTabId[] {
  return tabs.filter((tab) => isAgentDefaultsTabVisibleInMode(tab, mode));
}

export function isGatewaySettingsTabVisibleInMode(
  tab: GatewaySettingsTabId,
  mode: SettingsMode,
): boolean {
  if (mode === 'advanced') {
    return true;
  }
  return !SIMPLE_MODE_HIDDEN_GATEWAY_TABS.has(tab);
}

export function visibleGatewaySettingsTabs(
  tabs: readonly GatewaySettingsTabId[],
  mode: SettingsMode,
): GatewaySettingsTabId[] {
  return tabs.filter((tab) => isGatewaySettingsTabVisibleInMode(tab, mode));
}

export function isBrowserSettingsTabVisibleInMode(tab: BrowserTabId, mode: SettingsMode): boolean {
  if (mode === 'advanced') {
    return true;
  }
  return !SIMPLE_MODE_HIDDEN_BROWSER_TABS.has(tab);
}

export function visibleBrowserSettingsTabs(
  tabs: readonly BrowserTabId[],
  mode: SettingsMode,
): BrowserTabId[] {
  return tabs.filter((tab) => isBrowserSettingsTabVisibleInMode(tab, mode));
}

export function fallbackAgentDefaultsTab(mode: SettingsMode): AgentDefaultsTabId {
  return 'model-strategy';
}

export function fallbackGatewaySettingsTab(): GatewaySettingsTabId {
  return 'network';
}

export function fallbackBrowserSettingsTab(): BrowserTabId {
  return 'overview';
}
