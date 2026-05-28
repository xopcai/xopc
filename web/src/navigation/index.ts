import type { StoredLanguage } from '@/lib/storage';

import type { SettingsSectionId, Tab } from '@/i18n/messages';

export type { SettingsSectionId, Tab } from '@/i18n/messages';

export type ChatRoute =
  | { type: 'recent' }
  | { type: 'session'; sessionKey: string }
  | { type: 'new' };

const SETTINGS_SECTION_TO_TAB: Record<SettingsSectionId, Tab> = {
  overview: 'settingsOverview',
  appearance: 'settingsAppearance',
  system: 'settingsSystem',
  'app-management': 'settingsAppManagement',
  agent: 'settingsAgents',
  'agent-defaults': 'settingsAgentChat',
  'agent-chat': 'settingsAgentChat',
  'agent-workspace': 'settingsAgentWorkspace',
  'agent-browser': 'settingsAgentBrowser',
  'agent-runtime': 'settingsAgentRuntime',
  'agent-context': 'settingsAgentContext',
  'agent-memory': 'settingsAgentMemory',
  'agent-tools': 'settingsAgentTools',
  'agent-skills': 'settingsAgentSkills',
  'agent-mcp': 'settingsAgentMcp',
  'agent-system-prompt': 'settingsAgentSystemPrompt',
  agents: 'settingsAgents',
  providers: 'settingsProviders',
  credentials: 'settingsCredentials',
  models: 'settingsModels',
  'image-models': 'settingsImageModels',
  channels: 'channels',
  voice: 'settingsVoice',
  gateway: 'settingsGateway',
  heartbeat: 'settingsHeartbeat',
  tunnel: 'settingsTunnel',
  'remote-access': 'settingsTunnel',
  shares: 'settingsShares',
  search: 'settingsSearch',
  dreams: 'settingsDreams',
  cron: 'settingsCron',
  goals: 'settingsGoals',
  skills: 'skills',
};

const TAB_TO_SETTINGS_SECTION: Record<
  | 'settingsOverview'
  | 'settingsAppearance'
  | 'settingsSystem'
  | 'settingsAppManagement'
  | 'settingsAgentDefaults'
  | 'settingsAgentBrowser'
  | 'settingsAgentMcp'
  | 'settingsAgents'
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
  | 'settingsCron'
  | 'settingsGoals'
  | 'skills'
  | 'channels',
  SettingsSectionId
> = {
  settingsOverview: 'overview',
  settingsAppearance: 'appearance',
  settingsSystem: 'system',
  settingsAppManagement: 'app-management',
  settingsAgentDefaults: 'agent-defaults',
  settingsAgentBrowser: 'agent-browser',
  settingsAgentMcp: 'agent-mcp',
  settingsAgents: 'agents',
  settingsCredentials: 'credentials',
  settingsProviders: 'providers',
  settingsModels: 'models',
  settingsImageModels: 'image-models',
  settingsChannels: 'channels',
  settingsVoice: 'voice',
  settingsGateway: 'gateway',
  settingsHeartbeat: 'heartbeat',
  settingsTunnel: 'remote-access',
  settingsShares: 'shares',
  settingsSearch: 'search',
  settingsDreams: 'dreams',
  settingsCron: 'cron',
  settingsGoals: 'goals',
  skills: 'skills',
  channels: 'channels',
};

export function settingsSectionToTab(section: SettingsSectionId): Tab {
  return SETTINGS_SECTION_TO_TAB[section];
}

export function tabToSettingsSection(tab: Tab): SettingsSectionId | null {
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
export const ELECTRON_ONLY_SETTINGS_TABS = new Set<Tab>(['settingsSystem', 'settingsAppManagement']);

/** Electron-only group — rendered above Extensions in the settings rail. */
export const ELECTRON_SYSTEM_NAV_GROUP: SettingsShellNavGroup = {
  id: 'system',
  tabs: ['settingsSystem', 'settingsAppManagement'],
};

/**
 * Settings rail. M3.1 collapsed two groups that previously exposed many
 * sibling rail items leading to the same underlying page or hub:
 *
 *   - `credentials` group: 6 → 1. The credentials hub
 *     (`/settings/credentials`) already lists LLM / search / image / voice as
 *     cards with manage links, so flat exposure of every sub-page in the rail
 *     was redundant.
 *   - `agent` group: 9 → 3. The agent-defaults page (`/settings/agent-defaults`)
 *     has internal tabs for chat / workspace / runtime / context / memory /
 *     tools / skills / system-prompt. Browser remains a first-level rail item
 *     because it is a core default next to model and chat settings.
 *
 * Old direct URLs (`/settings/providers`, `/settings/agent-tools`, …) keep
 * working — see `settings-page.tsx` and the legacy redirects.
 *
 * Electron system group and extensions append in `SettingsPageLayout`.
 */
export const SETTINGS_SHELL_NAV_GROUPS: readonly SettingsShellNavGroup[] = [
  { id: 'general', tabs: ['settingsOverview', 'settingsAppearance'] },
  { id: 'credentials', tabs: ['settingsCredentials'] },
  {
    id: 'agent',
    tabs: ['settingsAgentDefaults', 'settingsAgentBrowser', 'settingsAgentMcp'],
  },
  {
    id: 'connection',
    tabs: ['settingsGateway', 'settingsTunnel', 'settingsShares'],
  },
  {
    id: 'automation',
    tabs: ['settingsCron', 'settingsHeartbeat', 'settingsGoals', 'settingsDreams'],
  },
  { id: 'diagnostics', tabs: ['sessions', 'logs'] },
] as const;

/** Flat order: settings routes only (excludes sessions/logs). */
export const SETTINGS_NAV_TABS: readonly Tab[] = [
  ...SETTINGS_SHELL_NAV_GROUPS.flatMap((g) => (g.id === 'diagnostics' ? [] : [...g.tabs])),
  ...ELECTRON_SYSTEM_NAV_GROUP.tabs,
];

/** Settings shell: full left rail including sessions + logs and Electron group tabs. */
export const SETTINGS_SHELL_NAV_TABS: readonly Tab[] = [
  ...SETTINGS_SHELL_NAV_GROUPS.flatMap((g) => [...g.tabs]),
  ...ELECTRON_SYSTEM_NAV_GROUP.tabs,
];

/** Official docs site (VitePress `base: /xopc/`). */
export const HELP_DOCS_BASE_URL = 'https://xopcai.github.io/xopc';

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

export type RemoteAccessDocsSection = 'tailscale-serve' | 'public-tunnel' | 'ssh-tunnel' | 'lan' | 'advanced';

/** Remote access guide (`docs/remote-access.md`), optionally anchored to a section. */
export function remoteAccessDocsUrl(
  language: StoredLanguage,
  section?: RemoteAccessDocsSection,
): string {
  const href = docsGuidePageUrl(language, 'remote-access');
  return section ? `${href}#${section}` : href;
}

/** Parse `#/settings/<section>` etc. Returns null if not a settings route. */
export function parseSettingsHash(hash: string): SettingsSectionId | null {
  let h = hash.startsWith('#') ? hash.slice(1) : hash;
  if (h.startsWith('/')) h = h.slice(1);
  if (h === 'settings' || h === 'settings/') {
    return 'overview';
  }
  if (!h.startsWith('settings/')) return null;
  const rest = h.slice('settings/'.length);
  const parts = rest.split('/').filter(Boolean);
  const section = parts[0];
  if (!section) return 'overview';
  if (section === 'agents' && parts.length > 1) {
    return 'agents';
  }
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
  if (tab === 'agents' || tab === 'settingsAgents') return '/agents';
  if (tab === 'cron') return '/cron';
  if (tab === 'settingsCron') return '/settings/cron';
  if (tab === 'settingsGoals') return '/settings/goals';
  if (tab === 'skills') return '/skills';
  if (tab === 'channels' || tab === 'settingsChannels') return '/channels';
  if (tab === 'settingsAgentDefaults') return '/settings/agent-defaults';
  if (tab === 'settingsAgentChat') return '/settings/agent-defaults';
  if (tab === 'settingsAgentWorkspace') return '/settings/agent-defaults?tab=workspace';
  if (tab === 'settingsAgentBrowser') return '/settings/agent-browser';
  if (tab === 'settingsAgentRuntime') return '/settings/agent-defaults?tab=runtime';
  if (tab === 'settingsAgentContext') return '/settings/agent-defaults?tab=context';
  if (tab === 'settingsAgentMemory') return '/settings/agent-defaults?tab=memory';
  if (tab === 'settingsAgentTools') return '/settings/agent-defaults?tab=tools';
  if (tab === 'settingsAgentSkills') return '/settings/agent-defaults?tab=skills';
  if (tab === 'settingsAgentSystemPrompt') return '/settings/agent-defaults?tab=system-prompt';
  const section = tabToSettingsSection(tab);
  if (section) return `/settings/${section}`;
  if (tab === 'sessions' || tab === 'logs') {
    return `/settings/${tab}`;
  }
  return `/${tab}`;
}
