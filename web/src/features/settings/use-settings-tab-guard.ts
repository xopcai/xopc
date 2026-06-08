import { useEffect } from 'react';

import type { AgentDefaultsTabId } from '@/features/settings/agents/agent-defaults-tabs';
import type { BrowserTabId } from '@/features/settings/agents/agent-defaults-panels/browser/browser-tabs';
import {
  fallbackAgentDefaultsTab,
  fallbackBrowserSettingsTab,
  fallbackGatewaySettingsTab,
  isAgentDefaultsTabVisibleInMode,
  isBrowserSettingsTabVisibleInMode,
  isGatewaySettingsTabVisibleInMode,
  type GatewaySettingsTabId,
} from '@/navigation/settings-field-visibility';
import { useSettingsModeStore } from '@/stores/settings-mode-store';

/** Redirect away from tabs that are hidden in simple settings mode. */
export function useAgentDefaultsTabGuard(
  activeTab: AgentDefaultsTabId,
  setActiveTab: (tab: AgentDefaultsTabId) => void,
): void {
  const mode = useSettingsModeStore((s) => s.mode);
  useEffect(() => {
    if (isAgentDefaultsTabVisibleInMode(activeTab, mode)) {
      return;
    }
    setActiveTab(fallbackAgentDefaultsTab(mode));
  }, [activeTab, mode, setActiveTab]);
}

export function useGatewaySettingsTabGuard(
  activeTab: GatewaySettingsTabId,
  setActiveTab: (tab: GatewaySettingsTabId) => void,
): void {
  const mode = useSettingsModeStore((s) => s.mode);
  useEffect(() => {
    if (isGatewaySettingsTabVisibleInMode(activeTab, mode)) {
      return;
    }
    setActiveTab(fallbackGatewaySettingsTab());
  }, [activeTab, mode, setActiveTab]);
}

export function useBrowserSettingsTabGuard(
  activeTab: BrowserTabId,
  setActiveTab: (tab: BrowserTabId) => void,
): void {
  const mode = useSettingsModeStore((s) => s.mode);
  useEffect(() => {
    if (isBrowserSettingsTabVisibleInMode(activeTab, mode)) {
      return;
    }
    setActiveTab(fallbackBrowserSettingsTab());
  }, [activeTab, mode, setActiveTab]);
}
