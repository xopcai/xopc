import type { Location } from 'react-router-dom';

import {
  parseAgentDefaultsTab,
  type AgentDefaultsTabId,
} from '@/features/settings/agents/agent-defaults-tabs';
import type { Tab } from '@/i18n/messages';

const AGENT_DEFAULTS_NAV_TAB_TO_TAB_ID: Partial<Record<Tab, AgentDefaultsTabId>> = {
  settingsAgentDefaults: 'chat',
  settingsAgentChat: 'chat',
  settingsAgentWorkspace: 'workspace',
  settingsAgentBrowser: 'browser',
  settingsAgentRuntime: 'runtime',
  settingsAgentContext: 'context',
  settingsAgentMemory: 'memory',
  settingsAgentTools: 'tools',
  settingsAgentSkills: 'skills',
  settingsAgentSystemPrompt: 'system-prompt',
};

export function isAgentDefaultsNavTab(tab: Tab): tab is keyof typeof AGENT_DEFAULTS_NAV_TAB_TO_TAB_ID {
  return tab in AGENT_DEFAULTS_NAV_TAB_TO_TAB_ID;
}

/** Left-rail highlight for merged `/settings/agent-defaults?tab=…` routes. */
export function isAgentDefaultsNavActive(tab: Tab, location: Location): boolean {
  if (!isAgentDefaultsNavTab(tab)) {
    return false;
  }
  const expectedTabId = AGENT_DEFAULTS_NAV_TAB_TO_TAB_ID[tab];
  if (!expectedTabId) {
    return false;
  }
  const pathname = location.pathname.replace(/\/+$/, '');
  if (!pathname.endsWith('/settings/agent-defaults')) {
    return false;
  }
  const currentTabId = parseAgentDefaultsTab(new URLSearchParams(location.search).get('tab'));
  return currentTabId === expectedTabId;
}
