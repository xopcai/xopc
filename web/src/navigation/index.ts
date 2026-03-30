import type { StoredLanguage } from '@/lib/storage';

import type { SettingsSectionId, Tab } from '@/i18n/messages';

export type { SettingsSectionId, Tab } from '@/i18n/messages';

export type ChatRoute =
  | { type: 'recent' }
  | { type: 'session'; sessionKey: string }
  | { type: 'new' };

const SETTINGS_SECTION_TO_TAB: Record<SettingsSectionId, Tab> = {
  appearance: 'settingsAppearance',
  agent: 'settingsAgent',
  providers: 'settingsProviders',
  models: 'settingsModels',
  channels: 'settingsChannels',
  voice: 'settingsVoice',
  gateway: 'settingsGateway',
  heartbeat: 'settingsHeartbeat',
  search: 'settingsSearch',
};

const TAB_TO_SETTINGS_SECTION: Record<
  | 'settingsAppearance'
  | 'settingsAgent'
  | 'settingsProviders'
  | 'settingsModels'
  | 'settingsChannels'
  | 'settingsVoice'
  | 'settingsGateway'
  | 'settingsHeartbeat'
  | 'settingsSearch',
  SettingsSectionId
> = {
  settingsAppearance: 'appearance',
  settingsAgent: 'agent',
  settingsProviders: 'providers',
  settingsModels: 'models',
  settingsChannels: 'channels',
  settingsVoice: 'voice',
  settingsGateway: 'gateway',
  settingsHeartbeat: 'heartbeat',
  settingsSearch: 'search',
};

export function settingsSectionToTab(section: SettingsSectionId): Tab {
  return SETTINGS_SECTION_TO_TAB[section];
}

export function tabToSettingsSection(tab: Tab): SettingsSectionId | null {
  return TAB_TO_SETTINGS_SECTION[tab as keyof typeof TAB_TO_SETTINGS_SECTION] ?? null;
}

/** Group keys for `messages(lang).settingsNavGroups` — left rail sections + sort order. */
export type SettingsNavGroupId =
  | 'interface'
  | 'agentAndModels'
  | 'channelsAndVoice'
  | 'gateway'
  | 'data';

export type SettingsShellNavGroup = {
  id: SettingsNavGroupId;
  tabs: readonly Tab[];
};

/**
 * Priority: connection → AI (keys → model → agent) → common ops (sessions/logs) →
 * UI prefs → integrations. See `settingsNavGroups` copy in i18n.
 */
export const SETTINGS_SHELL_NAV_GROUPS: readonly SettingsShellNavGroup[] = [
  { id: 'gateway', tabs: ['settingsGateway', 'settingsHeartbeat'] },
  {
    id: 'agentAndModels',
    tabs: ['settingsProviders', 'settingsModels', 'settingsAgent', 'settingsSearch'],
  },
  { id: 'data', tabs: ['sessions', 'logs'] },
  { id: 'interface', tabs: ['settingsAppearance'] },
  { id: 'channelsAndVoice', tabs: ['settingsChannels', 'settingsVoice'] },
] as const;

/** Flat order: settings routes only (excludes sessions/logs). */
export const SETTINGS_NAV_TABS: readonly Tab[] = SETTINGS_SHELL_NAV_GROUPS.filter((g) => g.id !== 'data').flatMap(
  (g) => [...g.tabs],
);

/** Settings shell: full left rail including sessions + logs. */
export const SETTINGS_SHELL_NAV_TABS: readonly Tab[] = SETTINGS_SHELL_NAV_GROUPS.flatMap((g) => [...g.tabs]);

/** Official docs site (VitePress `base: /xopcbot/`). */
export const HELP_DOCS_BASE_URL = 'https://xopcai.github.io/xopcbot';

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

/** Parse `#/settings/<section>` etc. Returns null if not a settings route. */
export function parseSettingsHash(hash: string): SettingsSectionId | null {
  let h = hash.startsWith('#') ? hash.slice(1) : hash;
  if (h.startsWith('/')) h = h.slice(1);
  if (h === 'settings' || h === 'settings/') {
    return 'gateway';
  }
  if (!h.startsWith('settings/')) return null;
  const rest = h.slice('settings/'.length);
  const section = rest.split('/')[0];
  if (!section) return 'gateway';
  return section in SETTINGS_SECTION_TO_TAB ? (section as SettingsSectionId) : null;
}

export function getSettingsHash(section: SettingsSectionId): string {
  return `#/settings/${section}`;
}

export function parseChatHash(hash: string): ChatRoute | null {
  const withoutHash = hash.startsWith('#') ? hash.slice(1) : hash;
  const cleanHash = withoutHash.replace(/^\/?chat\/?/, '');

  if (!cleanHash || cleanHash === '/') {
    return { type: 'recent' };
  }

  const path = cleanHash.replace(/^\/?/, '');

  if (path === 'new') {
    return { type: 'new' };
  }

  if (path && path.length > 0) {
    return { type: 'session', sessionKey: decodeURIComponent(path) };
  }

  return { type: 'recent' };
}

export function getChatHash(route: ChatRoute): string {
  switch (route.type) {
    case 'recent':
      return '#/chat';
    case 'new':
      return '#/chat/new';
    case 'session':
      return `#/chat/${encodeURIComponent(route.sessionKey)}`;
  }
}

/** Path for React Router `to` prop (hash router, no `#`). */
export function pathForTab(tab: Tab): string {
  if (tab === 'chat') return '/chat';
  const section = tabToSettingsSection(tab);
  if (section) return `/settings/${section}`;
  if (tab === 'sessions' || tab === 'logs') return `/settings/${tab}`;
  return `/${tab}`;
}
