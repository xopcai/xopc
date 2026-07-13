import { useEffect } from 'react';
import type { ImperativeRouter } from 'expo-router';

import { useGatewayConfigured } from '../../query/sessions';
import { useGatewayStore } from '../../stores/gateway-store';
import { usePreferencesStore } from '../../stores/preferences-store';

import {
  subscribeToMobileNotifications,
  syncMobileNotificationRegistration,
} from './mobile-notifications';

export function useMobileNotifications(router: ImperativeRouter): void {
  const configured = useGatewayConfigured();
  const enabled = usePreferencesStore((state) => state.notificationsEnabled);
  const activeGatewayId = useGatewayStore((state) => state.activeGatewayId);

  useEffect(() => subscribeToMobileNotifications(router), [router]);

  useEffect(() => {
    if (!configured || !enabled) return;
    void syncMobileNotificationRegistration();
  }, [activeGatewayId, configured, enabled]);
}
