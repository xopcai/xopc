import { html, nothing } from 'lit';
import type { TemplateResult } from 'lit';
import { t } from './utils/i18n';
import { getIcon } from './utils/icons';

// Tab groups configuration
export const TAB_GROUPS = [
  { label: 'Chat', tabs: ['chat'] },
  { label: 'Management', tabs: ['sessions', 'subagents', 'cron'] },
  { label: 'Settings', tabs: ['settings'] },
] as const;

export type Tab = 'chat' | 'sessions' | 'subagents' | 'cron' | 'settings';

export interface NavItem {
  id: Tab;
  label: string;
  icon: string;
}

// Chat route with optional session key
export type ChatRoute = 
  | { type: 'recent' }  // Most recent session
  | { type: 'session'; sessionKey: string }
  | { type: 'new' };    // Create new session

// Parse hash to get chat route
export function parseChatHash(hash: string): ChatRoute | null {
  const cleanHash = hash.replace(/^#\/?chat\/?/, '');
  
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

const TAB_CONFIG: Record<Tab, { label: string; icon: string; subtitle: string }> = {
  chat: {
    label: t('nav.chat'),
    icon: 'messageSquare',
    subtitle: t('nav.chatSubtitle'),
  },
  sessions: {
    label: t('nav.sessions'),
    icon: 'folderOpen',
    subtitle: t('nav.sessionsSubtitle'),
  },
  subagents: {
    label: t('nav.subagents'),
    icon: 'bot',
    subtitle: t('nav.subagentsSubtitle'),
  },
  cron: {
    label: t('nav.cron'),
    icon: 'clock',
    subtitle: t('nav.cronSubtitle'),
  },
  settings: {
    label: t('nav.settings'),
    icon: 'settings',
    subtitle: t('nav.settingsSubtitle'),
  },
};

export function titleForTab(tab: Tab): string {
  return TAB_CONFIG[tab]?.label || 'Unknown';
}

export function subtitleForTab(tab: Tab): string {
  return TAB_CONFIG[tab]?.subtitle || '';
}

export function iconForTab(tab: Tab): string {
  return TAB_CONFIG[tab]?.icon || 'folder';
}

// Render navigation item
export function renderNavItem(
  tab: Tab,
  isActive: boolean,
  onClick: () => void
): TemplateResult {
  const config = TAB_CONFIG[tab];
  
  return html`
    <button 
      class="nav-item ${isActive ? 'nav-item--active' : ''}"
      @click=${onClick}
      role="tab"
      aria-selected=${isActive}
    >
      <span class="nav-item__icon">${getIcon(config.icon)}</span>
      <span class="nav-item__text">${config.label}</span>
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
