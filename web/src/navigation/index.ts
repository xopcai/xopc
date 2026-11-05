import type { StoredLanguage } from '@/lib/storage';

import type { SettingsSectionId, Tab } from '@/i18n/messages';

export type { SettingsSectionId, Tab } from '@/i18n/messages';

const TAB_TO_SETTINGS_SECTION: Record<
  | 'settingsImports'
  | 'settingsOverview'
  | 'settingsAppearance'
  | 'settingsPersonal'
  | 'settingsSystem'
  | 'settingsDesktopPet'
  | 'settingsDesktopApp'
  | 'settingsKeyboardShortcuts'
  | 'settingsAgentDefaults'
  | 'settingsGateway'
  | 'settingsRuntimes'
  | 'settingsDevices'
  | 'settingsTunnel'
  | 'settingsShares',
  SettingsSectionId
> = {
  settingsImports: 'imports',
  settingsOverview: 'overview',
  settingsAppearance: 'appearance',
  settingsKeyboardShortcuts: 'keyboard-shortcuts',
  settingsPersonal: 'personal',
  settingsSystem: 'system',
  settingsDesktopPet: 'desktop-pet',
  settingsDesktopApp: 'desktop-app',
  settingsAgentDefaults: 'agent-defaults',
  settingsGateway: 'gateway',
  settingsRuntimes: 'runtimes',
  settingsDevices: 'devices',
  settingsTunnel: 'remote-access',
  settingsShares: 'shares',
};

function tabToSettingsSection(tab: Tab): SettingsSectionId | null {
  return TAB_TO_SETTINGS_SECTION[tab as keyof typeof TAB_TO_SETTINGS_SECTION] ?? null;
}

/** Group keys for `messages(lang).settingsNavGroups` — left rail sections + sort order. */
export type SettingsNavGroupId = 'general' | 'capabilities' | 'connection' | 'data' | 'diagnostics';

export type SettingsShellNavGroup = {
  id: SettingsNavGroupId;
  tabs: readonly Tab[];
};

export const ELECTRON_ONLY_SETTINGS_TABS = new Set<Tab>([
  'settingsDesktopPet',
  'settingsDesktopApp',
]);

/** Group by user intent; platform and advanced-mode visibility are applied by the rail. */
export const SETTINGS_SHELL_NAV_GROUPS: readonly SettingsShellNavGroup[] = [
  { id: 'general', tabs: ['settingsOverview', 'settingsAppearance', 'settingsKeyboardShortcuts', 'settingsSystem', 'settingsDesktopPet'] },
  { id: 'capabilities', tabs: ['settingsPersonal', 'settingsModels', 'settingsSearch', 'settingsAgentDefaults'] },
  { id: 'connection', tabs: ['settingsGateway', 'settingsDevices', 'settingsAgentBrowser', 'settingsComputerUse', 'settingsPhoneUse', 'settingsTunnel'] },
  { id: 'data', tabs: ['settingsImports', 'sessions', 'usage', 'settingsShares', 'settingsDesktopApp'] },
  { id: 'diagnostics', tabs: ['settingsRuntimes', 'tracing', 'logs'] },
] as const;

/** Official docs site (VitePress `base: /xopc/`). */
const HELP_DOCS_BASE_URL = 'https://xopcai.github.io/xopc';

/** Sidebar “Documentation” — English root vs `zh/` locale home. */
export function helpDocsHomeUrl(language: StoredLanguage): string {
  return language === 'zh' ? `${HELP_DOCS_BASE_URL}/zh/` : `${HELP_DOCS_BASE_URL}/`;
}

/**
 * Path to a VitePress guide page (e.g. `models` → `/models.md` in repo root `docs/`).
 * Chinese lives under `docs/zh/` → `/zh/<page>` on the site.
 */
export function docsGuidePageUrl(language: StoredLanguage, page: string): string {
  const slug = page.replace(/^\/+/, '').replace(/\.md$/, '');
  if (language === 'zh') {
    return `${HELP_DOCS_BASE_URL}/zh/${slug}`;
  }
  return `${HELP_DOCS_BASE_URL}/${slug}`;
}

export type RemoteAccessDocsSection =
  | 'tailscale-serve'
  | 'public-tunnel'
  | 'reverse-proxy'
  | 'ssh-tunnel'
  | 'lan'
  | 'advanced';

/** Remote access guide (`docs/remote-access.md`), optionally anchored to a section. */
export function remoteAccessDocsUrl(
  language: StoredLanguage,
  section?: RemoteAccessDocsSection,
): string {
  const href = docsGuidePageUrl(language, 'remote-access');
  return section ? `${href}#${section}` : href;
}

/** Browser tools guide (`docs/tools.md#browser-optional`). */
export function browserDocsUrl(language: StoredLanguage): string {
  return `${docsGuidePageUrl(language, 'tools')}#browser-optional`;
}

/** Path for React Router `to` prop (hash router, no `#`). */
export function pathForTab(tab: Tab): string {
  if (tab === 'settingsKeyboardShortcuts') return '/settings/keyboard-shortcuts';
  if (tab === 'settingsAgentBrowser') return '/settings/agent-browser';
  if (tab === 'settingsPhoneUse') return '/settings/phone-use';
  if (tab === 'settingsComputerUse') return '/settings/computer-use';
  if (tab === 'settingsModels') return capabilitySettingsPath('models');
  if (tab === 'settingsSearch') return capabilitySettingsPath('search');
  const section = tabToSettingsSection(tab);
  if (section) return `/settings/${section}`;
  if (tab === 'sessions' || tab === 'usage' || tab === 'tracing' || tab === 'logs') {
    return `/settings/${tab}`;
  }
  return `/${tab}`;
}

export type CapabilitySettingsSectionId = 'models' | 'search';

export const CAPABILITY_SETTINGS_SECTIONS: readonly CapabilitySettingsSectionId[] = [
  'models',
  'search',
] as const;

export function capabilitySettingsPath(section: CapabilitySettingsSectionId): string {
  return `/settings/capabilities/${section}`;
}

/** All model and voice configuration shares the Models destination. */
export function isSettingsTabActiveAtPath(tab: Tab, pathname: string): boolean {
  if (tab === 'settingsModels') {
    return pathname === capabilitySettingsPath('models');
  }
  return pathname === pathForTab(tab);
}

/** Resolve catalog documentation paths against the public documentation site. */
export function channelDocsUrl(language: StoredLanguage, docsPath: string): string {
  if (/^https:\/\//i.test(docsPath)) return docsPath;
  if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(docsPath)) return helpDocsHomeUrl(language);
  return docsGuidePageUrl(language, docsPath.replace(/^\/?zh\//, ''));
}
