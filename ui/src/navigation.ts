import { html } from 'lit';
import type { TemplateResult } from 'lit';
import { getIcon } from './utils/icons';
import { t } from './utils/i18n';

/** URL segment under `#/settings/...` — must match SettingsPage sections */
export type SettingsSectionId = 'agent' | 'providers' | 'models' | 'channels' | 'voice' | 'gateway';

export type SettingsTab =
  | 'settingsAgent'
  | 'settingsProviders'
  | 'settingsModels'
  | 'settingsChannels'
  | 'settingsVoice'
  | 'settingsGateway';

export type Tab =
  | 'chat'
  | 'sessions'
  | 'cron'
  | 'skills'
  | 'logs'
  | SettingsTab;

const SETTINGS_SECTION_TO_TAB: Record<SettingsSectionId, SettingsTab> = {
  agent: 'settingsAgent',
  providers: 'settingsProviders',
  models: 'settingsModels',
  channels: 'settingsChannels',
  voice: 'settingsVoice',
  gateway: 'settingsGateway',
};

const TAB_TO_SETTINGS_SECTION: Record<SettingsTab, SettingsSectionId> = {
  settingsAgent: 'agent',
  settingsProviders: 'providers',
  settingsModels: 'models',
  settingsChannels: 'channels',
  settingsVoice: 'voice',
  settingsGateway: 'gateway',
};

// Get tab groups with i18n labels
export function getTabGroups() {
  return [
    { label: t('nav.chat'), tabs: ['chat'] as const },
    { label: t('nav.management'), tabs: ['sessions', 'cron', 'skills', 'logs'] as const },
    {
      label: t('nav.settings'),
      tabs: [
        'settingsAgent',
        'settingsProviders',
        'settingsModels',
        'settingsChannels',
        'settingsVoice',
        'settingsGateway',
      ] as const,
    },
  ];
}

export function settingsSectionToTab(section: SettingsSectionId): SettingsTab {
  return SETTINGS_SECTION_TO_TAB[section];
}

export function tabToSettingsSection(tab: Tab): SettingsSectionId | null {
  return TAB_TO_SETTINGS_SECTION[tab as SettingsTab] ?? null;
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
  const section = rest.split('/')[0] as string;
  if (!section) return 'agent';
  return SETTINGS_SECTION_TO_TAB[section as SettingsSectionId] ? (section as SettingsSectionId) : null;
}

export function getSettingsHash(section: SettingsSectionId): string {
  return `#/settings/${section}`;
}

export interface NavItem {
  id: Tab;
  label: string;
  icon: string;
}

// Get tab label (supports i18n)
export function getTabLabel(tab: Tab): string {
  const section = tabToSettingsSection(tab);
  if (section) {
    return t(`settings.sections.${section}`);
  }
  return t(`nav.${tab}`);
}

// Tab icon map (no subtitle needed)
const TAB_ICONS: Record<Tab, string> = {
  chat: 'messageSquare',
  sessions: 'folderOpen',
  cron: 'clock',
  skills: 'layers',
  logs: 'fileText',
  settingsAgent: 'bot',
  settingsProviders: 'cloud',
  settingsModels: 'cpu',
  settingsChannels: 'plug',
  settingsVoice: 'mic',
  settingsGateway: 'globe',
};

// Chat route with optional session key
export type ChatRoute = 
  | { type: 'recent' }  // Most recent session
  | { type: 'session'; sessionKey: string }
  | { type: 'new' };    // Create new session

// Parse hash to get chat route
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
  
  // Validate session key format (should be alphanumeric with colons)
  if (path && path.length > 0) {
    return { type: 'session', sessionKey: decodeURIComponent(path) };
  }
  
  return { type: 'recent' };
}

// Get hash from chat route
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

// Render navigation item
export function renderNavItem(
  tab: Tab,
  isActive: boolean,
  onClick: () => void
): TemplateResult {
  const icon = TAB_ICONS[tab];
  const label = getTabLabel(tab);
  
  return html`
    <button 
      class="nav-item ${isActive ? 'nav-item--active' : ''}"
      @click=${onClick}
      role="tab"
      aria-selected=${isActive}
    >
      <span class="nav-item__icon">${getIcon(icon)}</span>
      <span class="nav-item__text">${label}</span>
    </button>
  `;
}

// Render a collapsed navigation group
export function renderNavGroup(
  label: string,
  items: TemplateResult[],
  isCollapsed: boolean = false
): TemplateResult {
  return html`
    <div class="nav-group ${isCollapsed ? 'nav-group--collapsed' : ''}">
      <div class="nav-label nav-label--static">
        <span class="nav-label__text">${label}</span>
      </div>
      <div class="nav-group__items">
        ${items}
      </div>
    </div>
  `;
}
