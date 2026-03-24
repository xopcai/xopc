import type { SettingsSectionId, Tab } from '@/i18n/messages';

export type { SettingsSectionId, Tab } from '@/i18n/messages';

export type ChatRoute =
  | { type: 'recent' }
  | { type: 'session'; sessionKey: string }
  | { type: 'new' };

const SETTINGS_SECTION_TO_TAB: Record<SettingsSectionId, Tab> = {
  agent: 'settingsAgent',
  providers: 'settingsProviders',
  models: 'settingsModels',
  channels: 'settingsChannels',
  voice: 'settingsVoice',
  gateway: 'settingsGateway',
};

const TAB_TO_SETTINGS_SECTION: Record<
  | 'settingsAgent'
  | 'settingsProviders'
  | 'settingsModels'
  | 'settingsChannels'
  | 'settingsVoice'
  | 'settingsGateway',
  SettingsSectionId
> = {
  settingsAgent: 'agent',
  settingsProviders: 'providers',
  settingsModels: 'models',
  settingsChannels: 'channels',
  settingsVoice: 'voice',
  settingsGateway: 'gateway',
};

export function settingsSectionToTab(section: SettingsSectionId): Tab {
  return SETTINGS_SECTION_TO_TAB[section];
}

export function tabToSettingsSection(tab: Tab): SettingsSectionId | null {
  return TAB_TO_SETTINGS_SECTION[tab as keyof typeof TAB_TO_SETTINGS_SECTION] ?? null;
}

/** Parse `#/settings/agent` etc. Returns null if not a settings route. */
export function parseSettingsHash(hash: string): SettingsSectionId | null {
  let h = hash.startsWith('#') ? hash.slice(1) : hash;
  if (h.startsWith('/')) h = h.slice(1);
  if (h === 'settings' || h === 'settings/') {
    return 'agent';
  }
  if (!h.startsWith('settings/')) return null;
  const rest = h.slice('settings/'.length);
  const section = rest.split('/')[0];
  if (!section) return 'agent';
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
  return `/${tab}`;
}
