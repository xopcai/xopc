import { useEffect } from 'react';

import type { BrowserTabId } from '@/features/settings/browser/panels/browser-tabs';
import {
  fallbackBrowserSettingsTab,
  fallbackGatewaySettingsTab,
  isBrowserSettingsTabVisibleInMode,
  isGatewaySettingsTabVisibleInMode,
  type GatewaySettingsTabId,
} from '@/navigation/settings-field-visibility';
import { useSettingsModeStore } from '@/stores/settings-mode-store';

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
