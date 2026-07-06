import { describe, expect, it } from 'vitest';

import { deriveGatewayConnectionView } from '../gateway-connection-view';
import { buildGatewayPickerRowSubtitle } from '../gateway-picker-subtitle';
import type { GatewayProfile } from '../../../stores/gateway-types';
import { en } from '../../../i18n/locales/en';

const profile: GatewayProfile = {
  id: 'p1',
  name: 'Office',
  baseUrl: 'https://tunnel.example.com',
  lanUrl: 'http://192.168.1.5:18790',
  token: '',
  updatedAt: 1,
};

describe('buildGatewayPickerRowSubtitle', () => {
  it('shows hostname only for non-active profiles', () => {
    expect(
      buildGatewayPickerRowSubtitle(
        profile,
        false,
        deriveGatewayConnectionView({ baseUrl: '', lanUrl: null, activeBaseUrl: '' }),
        true,
        en.gateway,
        en.chat,
      ),
    ).toBe('tunnel.example.com');
  });

  it('shows route and online status for active profile', () => {
    const view = deriveGatewayConnectionView({
      baseUrl: profile.baseUrl,
      lanUrl: profile.lanUrl,
      activeBaseUrl: profile.lanUrl!,
    });
    expect(
      buildGatewayPickerRowSubtitle(profile, true, view, true, en.gateway, en.chat),
    ).toBe('192.168.1.5:18790 · LAN · Online');
  });

  it('shows offline status for active profile when unreachable', () => {
    const view = deriveGatewayConnectionView({
      baseUrl: profile.baseUrl,
      lanUrl: null,
      activeBaseUrl: profile.baseUrl,
    });
    expect(
      buildGatewayPickerRowSubtitle(profile, true, view, false, en.gateway, en.chat),
    ).toBe('tunnel.example.com · Direct · Offline');
  });
});
