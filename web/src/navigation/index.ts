import type { StoredLanguage } from '@/lib/storage';

import type { SettingsSectionId, Tab } from '@/i18n/messages';

export type { SettingsSectionId, Tab } from '@/i18n/messages';

const TAB_TO_SETTINGS_SECTION: Record<
  | 'settingsOverview'
  | 'settingsAppearance'
  | 'settingsSystem'
  | 'settingsAppManagement'
  | 'settingsAgentDefaults'
  | 'settingsAgentBrowser'
  | 'settingsAgentMcp'
  | 'settingsKeyboardShortcuts'
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
  | 'settingsGoals'
  | 'skills'
  | 'channels',
  SettingsSectionId
> = {
  settingsOverview: 'overview',
  settingsAppearance: 'appearance',
  settingsKeyboardShortcuts: 'keyboard-shortcuts',
  settingsSystem: 'system',
  settingsAppManagement: 'app-management',
  settingsAgentDefaults: 'agent-defaults',
  settingsAgentBrowser: 'agent-browser',
  settingsAgentMcp: 'agent-mcp',
  settingsAgents: 'agents',
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
 *   - `credentials` group: one Models & Capabilities center for keys, catalog,
 *     capability models, and setup health.
 *   - `agent` group: 9 → 3. The agent-defaults page (`/settings/agent-defaults`)
 *     has internal tabs for chat / workspace / runtime / context / memory /
 *     tools / skills / system-prompt. Browser remains a first-level rail item
 *     because it is a core default next to model and chat settings.
 *
 * Electron system group and extensions append in `SettingsPageLayout`.
 */
export const SETTINGS_SHELL_NAV_GROUPS: readonly SettingsShellNavGroup[] = [
  { id: 'general', tabs: ['settingsOverview', 'settingsAppearance', 'settingsKeyboardShortcuts'] },
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
  if (tab === 'cron') return '/cron';
  if (tab === 'settingsGoals') return '/settings/goals';
  if (tab === 'settingsKeyboardShortcuts') return '/settings/keyboard-shortcuts';
  if (tab === 'skills') return '/skills';
  if (tab === 'channels' || tab === 'settingsChannels') return '/channels';
  if (tab === 'settingsAgentDefaults') return '/settings/agent-defaults';
  if (tab === 'settingsAgentChat') return '/settings/agent-defaults';
  if (tab === 'settingsAgentGeneration') return '/settings/agent-defaults?tab=generation';
  if (tab === 'settingsAgentWorkspace') return '/settings/agent-defaults?tab=workspace';
  if (tab === 'settingsAgentBrowser') return '/settings/agent-browser';
  if (tab === 'settingsAgentRuntime') return '/settings/agent-defaults?tab=runtime';
  if (tab === 'settingsAgentContext') return '/settings/agent-defaults?tab=context';
  if (tab === 'settingsAgentMemory') return '/settings/agent-defaults?tab=memory';
  if (tab === 'settingsAgentTools') return '/settings/agent-defaults?tab=tools';
  if (tab === 'settingsAgentSkills') return '/settings/agent-defaults?tab=skills';
  if (tab === 'settingsAgentSystemPrompt') return '/settings/agent-defaults?tab=system-prompt';
  if (tab === 'settingsProviders') return '/settings/credentials?tab=providers';
  if (tab === 'settingsModels') return '/settings/credentials?tab=catalog';
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
