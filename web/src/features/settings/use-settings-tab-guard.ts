import { useEffect } from 'react';

import {
  fallbackGatewaySettingsTab,
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
