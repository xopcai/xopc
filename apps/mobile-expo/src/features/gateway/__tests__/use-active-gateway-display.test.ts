import { describe, expect, it } from 'vitest';

import { en } from '../../../i18n/locales/en';
import { resolveActiveGatewayDisplay } from '../active-gateway-display';
import { deriveGatewayConnectionView } from '../gateway-connection-view';
import type { GatewayProfile } from '../../../stores/gateway-types';

const profile: GatewayProfile = {
  id: 'p1',
  name: 'Home Lab',
  baseUrl: 'https://gw.example.com',
  lanUrl: null,
  token: 't',
  updatedAt: 1,
};

const g = en.gateway;
const notConfigured = 'Not configured';

describe('resolveActiveGatewayDisplay', () => {
  it('returns profile name and direct-route subtitle when set', () => {
    const connectionView = deriveGatewayConnectionView({
      baseUrl: 'https://gw.example.com',
      lanUrl: null,
      activeBaseUrl: 'https://gw.example.com',
    });
    expect(
      resolveActiveGatewayDisplay(profile, 'https://gw.example.com', connectionView, g, notConfigured),
    ).toEqual({
      name: 'Home Lab',
      subtitle: 'Home Lab · Direct',
      configured: true,
      profileId: 'p1',
    });
  });

  it('falls back to hostname when name is empty', () => {
    const baseUrl = 'https://my-gateway.example.com:18790';
    const connectionView = deriveGatewayConnectionView({
      baseUrl,
      lanUrl: null,
      activeBaseUrl: baseUrl,
    });
    expect(
      resolveActiveGatewayDisplay(
        { ...profile, name: '', baseUrl },
        baseUrl,
        connectionView,
        g,
        notConfigured,
      ),
    ).toEqual({
      name: 'my-gateway.example.com',
      subtitle: 'my-gateway.example.com · Direct',
      configured: true,
      profileId: 'p1',
    });
  });

  it('returns unconfigured when baseUrl is empty', () => {
    const connectionView = deriveGatewayConnectionView({
      baseUrl: '',
      lanUrl: null,
      activeBaseUrl: '',
    });
    expect(resolveActiveGatewayDisplay(null, '', connectionView, g, notConfigured)).toEqual({
      name: '',
      subtitle: notConfigured,
      configured: false,
      profileId: null,
    });
  });
});
