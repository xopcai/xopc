import { describe, expect, it } from 'vitest';

import { en } from '../../../i18n/locales/en';
import { buildChatHeaderGatewaySubtitle } from '../active-gateway-display';
import { deriveGatewayConnectionView } from '../gateway-connection-view';

describe('buildChatHeaderGatewaySubtitle', () => {
  const g = en.gateway;
  const tunnel = 'https://abc.frp.xopc.ai';
  const lan = 'http://192.168.1.10:18790';

  it('returns not configured label when gateway is missing', () => {
    expect(
      buildChatHeaderGatewaySubtitle(
        null,
        deriveGatewayConnectionView({ baseUrl: '', lanUrl: null, activeBaseUrl: '' }),
        false,
        g,
        'Not configured',
      ),
    ).toBe('Not configured');
  });

  it('shows LAN indicator when active route is LAN', () => {
    const view = deriveGatewayConnectionView({
      baseUrl: tunnel,
      lanUrl: lan,
      activeBaseUrl: lan,
    });
    expect(
      buildChatHeaderGatewaySubtitle(
        { id: '1', name: 'Home', baseUrl: tunnel, lanUrl: lan, token: '', updatedAt: 0 },
        view,
        true,
        g,
        'Not configured',
      ),
    ).toBe('Home · LAN');
  });

  it('shows FRP indicator when active route is public tunnel', () => {
    const view = deriveGatewayConnectionView({
      baseUrl: tunnel,
      lanUrl: lan,
      activeBaseUrl: tunnel,
    });
    expect(
      buildChatHeaderGatewaySubtitle(
        { id: '1', name: 'Home', baseUrl: tunnel, lanUrl: lan, token: '', updatedAt: 0 },
        view,
        true,
        g,
        'Not configured',
      ),
    ).toBe('Home · Public tunnel (FRP)');
  });
});
