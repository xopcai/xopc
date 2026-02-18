import { html, nothing } from 'lit';
import type { TemplateResult } from 'lit';
import { getIcon } from './utils/icons';

// Tab groups configuration
export const TAB_GROUPS = [
  { label: 'Chat', tabs: ['chat'] },
  { label: 'Management', tabs: ['sessions', 'cron', 'logs'] },
  { label: 'Settings', tabs: ['settings'] },
] as const;

export type Tab = 'chat' | 'sessions' | 'cron' | 'logs' | 'settings';

export interface NavItem {
  id: Tab;
  label: string;
  icon: string;
}

// Tab icon map (no subtitle needed)
const TAB_ICONS: Record<Tab, string> = {
  chat: 'messageSquare',
  sessions: 'folderOpen',
  cron: 'clock',
  logs: 'fileText',
  settings: 'settings',
};

const TAB_LABELS: Record<Tab, string> = {
  chat: 'Chat',
  sessions: 'Sessions',
  cron: 'Cron Jobs',
  logs: 'Logs',
  settings: 'Settings',
};

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

// Render navigation item
export function renderNavItem(
  tab: Tab,
  isActive: boolean,
  onClick: () => void
): TemplateResult {
  const icon = TAB_ICONS[tab];
  const label = TAB_LABELS[tab];
  
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
