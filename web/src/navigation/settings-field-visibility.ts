import type { SettingsMode } from '@/stores/settings-mode-store';

type BrowserTabId = 'overview' | 'extension' | 'local' | 'cloakbrowser' | 'cdp' | 'cloud';

export type GatewaySettingsTabId =
  | 'network'
  | 'access'
  | 'updates'
  | 'security'
  | 'advanced';

/** Gateway settings tabs hidden in simple mode. */
export const SIMPLE_MODE_HIDDEN_GATEWAY_TABS = new Set<GatewaySettingsTabId>([
  'updates',
  'security',
  'advanced',
]);

const SIMPLE_MODE_HIDDEN_BROWSER_TABS = new Set<BrowserTabId>([
  'local',
  'cdp',
  'cloud',
]);

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

export function fallbackGatewaySettingsTab(): GatewaySettingsTabId {
  return 'network';
}

export function fallbackBrowserSettingsTab(): BrowserTabId {
  return 'overview';
}
