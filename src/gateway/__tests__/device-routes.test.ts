import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  publicUrl: null as string | null,
  tunnelState: 'disconnected',
  reverseProxyUrl: null as string | null,
  tailscale: { active: false, hostname: undefined as string | undefined },
}));

vi.mock('../public-url.js', () => ({
  resolveReverseProxyPublicUrl: () => state.reverseProxyUrl,
}));

vi.mock('../tailscale-lifecycle.js', () => ({
  getTailscaleExposureState: () => state.tailscale,
}));

vi.mock('../../tunnel/tunnel-service.js', () => ({
  getTunnelService: () => ({
    getStatus: () => ({ state: state.tunnelState, publicUrl: state.publicUrl }),
  }),
}));

import { resolveSecureDeviceRoutes } from '../device-routes.js';

describe('resolveSecureDeviceRoutes', () => {
  beforeEach(() => {
    state.publicUrl = null;
    state.tunnelState = 'disconnected';
    state.reverseProxyUrl = null;
    state.tailscale = { active: false, hostname: undefined };
  });

  it('does not advertise a persisted tunnel URL while the tunnel is stopped', () => {
    state.publicUrl = 'https://stale.frp.xopc.ai';

    expect(resolveSecureDeviceRoutes({} as never)).toEqual([]);
  });

  it('publishes only active secure routes', () => {
    state.publicUrl = 'https://active.frp.xopc.ai';
    state.tunnelState = 'connected';
    state.reverseProxyUrl = 'https://gateway.example.com';
    state.tailscale = { active: true, hostname: 'gateway.tailnet.ts.net' };

    expect(resolveSecureDeviceRoutes({} as never).map(({ kind, url }) => ({ kind, url }))).toEqual([
      { kind: 'custom-https', url: 'https://gateway.example.com' },
      { kind: 'xopc-secure-link', url: 'https://active.frp.xopc.ai' },
      { kind: 'tailscale', url: 'https://gateway.tailnet.ts.net' },
    ]);
  });
});
