import type { BackendMode } from './backend-mode-list';

/** Internal tabs for `/settings/agent-browser`. */
export type BrowserTabId =
  | 'overview'
  | 'extension'
  | 'local'
  | 'cloakbrowser'
  | 'cdp'
  | 'cloud'
  | 'behavior';

export const BROWSER_TABS: readonly BrowserTabId[] = [
  'overview',
  'extension',
  'local',
  'cloakbrowser',
  'cdp',
  'cloud',
  'behavior',
] as const;

export const BROWSER_BACKEND_TABS: readonly BackendMode[] = [
  'extension',
  'local',
  'cloakbrowser',
  'cdp',
  'cloud',
] as const;

/** Legacy `?focus=` deep-links → tab id. */
export const LEGACY_BROWSER_FOCUS_TO_TAB: Record<string, BrowserTabId> = {
  connection: 'overview',
  extension: 'extension',
  local: 'local',
  cloak: 'cloakbrowser',
  cdp: 'cdp',
  cloud: 'cloud',
  runtime: 'behavior',
  security: 'behavior',
};

export function parseBrowserTab(raw: string | null | undefined): BrowserTabId {
  const id = (raw ?? '').trim();
  if (BROWSER_TABS.includes(id as BrowserTabId)) {
    return id as BrowserTabId;
  }
  return 'overview';
}

export function browserTabToBackend(tab: BrowserTabId): BackendMode | null {
  if (tab === 'overview' || tab === 'behavior') return null;
  return tab;
}

export function isBrowserBackendTab(tab: BrowserTabId): tab is BackendMode {
  return BROWSER_BACKEND_TABS.includes(tab as BackendMode);
}
