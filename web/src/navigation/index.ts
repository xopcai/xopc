import type { StoredLanguage } from '@/lib/storage';

import type { SettingsSectionId, Tab } from '@/i18n/messages';

export type { SettingsSectionId, Tab } from '@/i18n/messages';

const TAB_TO_SETTINGS_SECTION: Record<
  | 'settingsOverview'
  | 'settingsAppearance'
  | 'settingsSystem'
  | 'settingsDesktopPet'
  | 'settingsDesktopApp'
  | 'settingsKeyboardShortcuts'
  | 'settingsCapabilityPresets'
  | 'settingsChannels'
  | 'settingsGateway'
  | 'settingsRuntimes'
  | 'settingsDevices'
  | 'settingsMobile'
  | 'settingsHeartbeat'
  | 'settingsTunnel'
  | 'settingsShares'
  | 'skills'
  | 'channels',
  SettingsSectionId
> = {
  settingsOverview: 'overview',
  settingsAppearance: 'appearance',
  settingsKeyboardShortcuts: 'keyboard-shortcuts',
  settingsSystem: 'system',
  settingsDesktopPet: 'desktop-pet',
  settingsDesktopApp: 'desktop-app',
  settingsCapabilityPresets: 'capability-presets',
  settingsChannels: 'channels',
  settingsGateway: 'gateway',
  settingsRuntimes: 'runtimes',
  settingsDevices: 'devices',
  settingsMobile: 'mobile',
  settingsHeartbeat: 'heartbeat',
  settingsTunnel: 'remote-access',
  settingsShares: 'shares',
  skills: 'skills',
  channels: 'channels',
};

function tabToSettingsSection(tab: Tab): SettingsSectionId | null {
  return TAB_TO_SETTINGS_SECTION[tab as keyof typeof TAB_TO_SETTINGS_SECTION] ?? null;
}

/** Group keys for `messages(lang).settingsNavGroups` — left rail sections + sort order. */
export type SettingsNavGroupId =
  | 'general'
  | 'system'
  | 'capabilities'
  | 'agent'
  | 'connection'
  | 'automation'
  | 'diagnostics';

export type SettingsShellNavGroup = {
  id: SettingsNavGroupId;
  tabs: readonly Tab[];
};

/** Settings tabs shown only in the Electron desktop shell. */
export const ELECTRON_ONLY_SETTINGS_TABS = new Set<Tab>([
  'settingsSystem',
  'settingsDesktopPet',
  'settingsDesktopApp',
]);

/** Electron-only group — rendered above Extensions in the settings rail. */
export const ELECTRON_SYSTEM_NAV_GROUP: SettingsShellNavGroup = {
  id: 'system',
  tabs: ['settingsSystem', 'settingsDesktopPet', 'settingsDesktopApp'],
};

/**
 * Settings rail. M3.1 collapsed two groups that previously exposed many
 * sibling rail items leading to the same underlying page or hub:
 *
 *   - `capabilities` group: one Models & Services center with dedicated
 *     routes for models, images, voice, and web search.
 *   - `agent` group: manifest-first. Agent identity, workspace, model roles,
 *     tools, skills, memory, and boundaries are managed from `/agents`.
 *
 * Electron system group and extensions append in `SettingsPageLayout`.
 */
export const SETTINGS_SHELL_NAV_GROUPS: readonly SettingsShellNavGroup[] = [
  { id: 'general', tabs: ['settingsOverview', 'settingsAppearance', 'settingsKeyboardShortcuts'] },
  { id: 'capabilities', tabs: ['settingsCapabilities'] },
  {
    id: 'agent',
    tabs: ['settingsCapabilityPresets', 'settingsAgentBrowser'],
  },
  {
    id: 'connection',
    tabs: ['settingsMobile', 'settingsDevices', 'settingsGateway', 'settingsRuntimes', 'settingsTunnel', 'settingsShares'],
  },
  {
    id: 'automation',
    tabs: ['settingsHeartbeat'],
  },
  { id: 'diagnostics', tabs: ['sessions', 'logs'] },
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
  if (tab === 'chat') return '/chat';
  if (tab === 'agents') return '/agents';
  if (tab === 'automations') return '/automations';
  if (tab === 'settingsKeyboardShortcuts') return '/settings/keyboard-shortcuts';
  if (tab === 'skills') return '/skills';
  if (tab === 'connectors') return '/connectors';
  if (tab === 'channels' || tab === 'settingsChannels') return '/channels';
  if (tab === 'settingsAgentBrowser') return '/settings/agent-browser';
  if (tab === 'settingsCapabilities') return capabilitySettingsPath('models');
  const section = tabToSettingsSection(tab);
  if (section) return `/settings/${section}`;
  if (tab === 'sessions' || tab === 'logs') {
    return `/settings/${tab}`;
  }
  return `/${tab}`;
}

export type CapabilitySettingsSectionId = 'models' | 'image' | 'voice' | 'search';

export const CAPABILITY_SETTINGS_SECTIONS: readonly CapabilitySettingsSectionId[] = [
  'models',
  'image',
  'voice',
  'search',
] as const;

export function capabilitySettingsPath(section: CapabilitySettingsSectionId): string {
  return `/settings/capabilities/${section}`;
}
