import { describe, expect, it } from 'vitest';

import type { GatewayProfile } from '../../../stores/gateway-types';
import { en } from '../../../i18n/locales/en';
import { deriveGatewayConnectionView } from '../gateway-connection-view';
import { buildGatewaySwitcherSubtitle } from '../gateway-switcher-model';

const profile: GatewayProfile = {
  id: 'p1',
  name: 'Office',
  baseUrl: 'https://tunnel.example.com',
  lanUrl: 'http://192.168.1.5:18790',
  token: '',
  updatedAt: 1,
};

describe('buildGatewaySwitcherSubtitle', () => {
  it('keeps inactive rows quiet until a route has succeeded before', () => {
    const connectionView = deriveGatewayConnectionView({
      baseUrl: '',
      lanUrl: null,
      activeBaseUrl: '',
    });
    expect(buildGatewaySwitcherSubtitle({
      profile,
      isActive: false,
      gatewayOnline: true,
      hasLastAvailableRoute: false,
      connectionView,
      messages: en,
    })).toBe('tunnel.example.com');
    expect(buildGatewaySwitcherSubtitle({
      profile,
      isActive: false,
      gatewayOnline: true,
      hasLastAvailableRoute: true,
      connectionView,
      messages: en,
    })).toBe('tunnel.example.com · Recently available');
  });

  it('shows only connection and route context for the active row', () => {
    const connectionView = deriveGatewayConnectionView({
      baseUrl: profile.baseUrl,
      lanUrl: profile.lanUrl,
      activeBaseUrl: profile.lanUrl!,
    });
    expect(buildGatewaySwitcherSubtitle({
      profile,
      isActive: true,
      gatewayOnline: true,
      hasLastAvailableRoute: true,
      connectionView,
      messages: en,
    })).toBe('Connected · LAN');
  });
});
