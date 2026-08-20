import type { Tab } from '@/i18n/messages';
import type { SettingsMode } from '@/stores/settings-mode-store';

/** Settings rail tabs hidden when `mode === 'simple'`. */
export const SIMPLE_MODE_HIDDEN_SETTINGS_TABS = new Set<Tab>([
  'settingsTunnel',
  'settingsShares',
  'settingsHeartbeat',
  'logs',
]);

const SIMPLE_MODE_HIDDEN_SETTINGS_PATH_PREFIXES = [
  '/settings/remote-access',
  '/settings/tunnel',
  '/settings/shares',
  '/settings/heartbeat',
  '/settings/logs',
  '/settings/extensions/debug',
  '/settings/ext/',
] as const;

export function isSettingsTabVisibleInMode(tab: Tab, mode: SettingsMode): boolean {
  if (mode === 'advanced') {
    return true;
  }
  return !SIMPLE_MODE_HIDDEN_SETTINGS_TABS.has(tab);
}

export function isSettingsPathVisibleInMode(pathname: string, mode: SettingsMode): boolean {
  if (mode === 'advanced') {
    return true;
  }
  return !SIMPLE_MODE_HIDDEN_SETTINGS_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(prefix),
  );
}
