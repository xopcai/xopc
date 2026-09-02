import { describe, expect, it } from 'vitest';

import { parseGatewayProfile } from '../gateway-types';

describe('gateway profile contract', () => {
  const profile = {
    gatewayId: 'gateway-1',
    name: 'Studio',
    gatewayPublicKey: 'public-key',
    deviceId: 'device-1',
    scopes: ['gateway.status', 'sessions.read'],
    routes: [{ id: 'route-1', kind: 'custom-https', url: 'https://gateway.example.com' }],
    activeRouteId: 'route-1',
    updatedAt: 1,
  };

  it('accepts only the device-bound HTTPS profile shape', () => {
    expect(parseGatewayProfile(profile)).toEqual(profile);
    expect(parseGatewayProfile({ ...profile, routes: [{ ...profile.routes[0], url: 'http://192.168.1.2' }] })).toBeNull();
    expect(parseGatewayProfile({ id: 'legacy', baseUrl: 'https://gateway.example.com', token: 'secret' })).toBeNull();
  });
});
