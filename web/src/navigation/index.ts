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
  | 'settingsAgents'
  | 'settingsCapabilityPresets'
  | 'settingsUserProfile'
  | 'settingsCredentials'
  | 'settingsProviders'
  | 'settingsModels'
  | 'settingsImageModels'
  | 'settingsChannels'
  | 'settingsVoice'
  | 'settingsGateway'
  | 'settingsHeartbeat'
  | 'settingsTunnel'
  | 'settingsShares'
  | 'settingsSearch'
  | 'settingsDreams'
  | 'settingsGoals'
  | 'skills'
  | 'goals'
  | 'channels',
  SettingsSectionId
> = {
  settingsOverview: 'overview',
  settingsAppearance: 'appearance',
  settingsKeyboardShortcuts: 'keyboard-shortcuts',
  settingsSystem: 'system',
  settingsDesktopPet: 'desktop-pet',
  settingsDesktopApp: 'desktop-app',
  settingsAgents: 'agents',
  settingsCapabilityPresets: 'capability-presets',
  settingsUserProfile: 'user-profile',
  settingsCredentials: 'credentials',
  settingsProviders: 'credentials',
  settingsModels: 'credentials',
  settingsImageModels: 'credentials',
  settingsChannels: 'channels',
  settingsVoice: 'credentials',
  settingsGateway: 'gateway',
  settingsHeartbeat: 'heartbeat',
  settingsTunnel: 'remote-access',
  settingsShares: 'shares',
  settingsSearch: 'credentials',
  settingsDreams: 'dreams',
  settingsGoals: 'goals',
  skills: 'skills',
  goals: 'goals',
  channels: 'channels',
};

function tabToSettingsSection(tab: Tab): SettingsSectionId | null {
  return TAB_TO_SETTINGS_SECTION[tab as keyof typeof TAB_TO_SETTINGS_SECTION] ?? null;
}

/** Group keys for `messages(lang).settingsNavGroups` — left rail sections + sort order. */
export type SettingsNavGroupId =
  | 'general'
  | 'system'
  | 'credentials'
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
 *   - `credentials` group: one Models & Capabilities center for keys, catalog,
 *     capability models, and setup health.
 *   - `agent` group: manifest-first. Agent identity, workspace, model roles,
 *     tools, skills, memory, and boundaries are managed from `/agents`.
 *
 * Electron system group and extensions append in `SettingsPageLayout`.
 */
export const SETTINGS_SHELL_NAV_GROUPS: readonly SettingsShellNavGroup[] = [
  { id: 'general', tabs: ['settingsOverview', 'settingsAppearance', 'settingsKeyboardShortcuts'] },
  { id: 'credentials', tabs: ['settingsCredentials'] },
  {
    id: 'agent',
    tabs: ['settingsUserProfile', 'settingsCapabilityPresets', 'settingsAgentBrowser'],
  },
  {
    id: 'connection',
    tabs: ['settingsGateway', 'settingsTunnel', 'settingsShares'],
  },
  {
    id: 'automation',
    tabs: ['settingsHeartbeat', 'settingsGoals', 'settingsDreams'],
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
  if (tab === 'agents' || tab === 'settingsAgents') return '/agents';
  if (tab === 'automations') return '/automations';
  if (tab === 'goals') return '/goals';
  if (tab === 'settingsGoals') return '/settings/goals';
  if (tab === 'settingsKeyboardShortcuts') return '/settings/keyboard-shortcuts';
  if (tab === 'skills') return '/skills';
  if (tab === 'connectors') return '/connectors';
  if (tab === 'channels' || tab === 'settingsChannels') return '/channels';
  if (tab === 'settingsAgentBrowser') return '/settings/agent-browser';
  if (tab === 'settingsProviders') return '/settings/credentials?tab=services';
  if (tab === 'settingsModels') return '/settings/credentials?tab=services';
  if (tab === 'settingsImageModels') return '/settings/credentials?tab=image-models';
  if (tab === 'settingsVoice') return '/settings/credentials?tab=voice';
  if (tab === 'settingsSearch') return '/settings/credentials?tab=search';
  const section = tabToSettingsSection(tab);
  if (section) return `/settings/${section}`;
  if (tab === 'sessions' || tab === 'logs') {
    return `/settings/${tab}`;
  }
  return `/${tab}`;
}
