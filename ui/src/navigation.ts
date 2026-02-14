import { html, nothing } from 'lit';
import type { TemplateResult } from 'lit';
import { t } from './utils/i18n';
import { getIcon } from './utils/icons';

// Tab groups configuration
export const TAB_GROUPS = [
  { label: 'Chat', tabs: ['chat'] },
  { label: 'Management', tabs: ['sessions', 'cron'] },
  { label: 'Settings', tabs: ['settings'] },
] as const;

export type Tab = 'chat' | 'sessions' | 'cron' | 'settings';

export interface NavItem {
  id: Tab;
  label: string;
  icon: string;
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
