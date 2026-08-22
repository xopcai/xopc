import { useEffect } from 'react';
import type { ImperativeRouter } from 'expo-router';

import { useGatewayConfigured } from '../../query/sessions';
import { useGatewayStore } from '../../stores/gateway-store';
import { usePreferencesStore } from '../../stores/preferences-store';

import {
  subscribeToMobileNotifications,
  syncMobileNotificationRegistration,
} from './mobile-notifications';

export function useMobileNotifications(router: ImperativeRouter, ready: boolean): void {
  const configured = useGatewayConfigured();
  const enabled = usePreferencesStore((state) => state.notificationsEnabled);
  const activeGatewayId = useGatewayStore((state) => state.activeGatewayId);

  useEffect(() => {
    if (!ready) return;
    return subscribeToMobileNotifications(router);
  }, [ready, router]);

  useEffect(() => {
    if (!ready || !configured || !enabled) return;
    void syncMobileNotificationRegistration();
  }, [activeGatewayId, configured, enabled, ready]);
}
