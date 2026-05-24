import { describe, expect, it } from 'vitest';

import type { Config } from '../../config/schema.js';
import {
  isTailscaleServeRequest,
  isTailscaleUiBypassPath,
  shouldAllowTailscaleIdentityAuth,
} from '../tailscale-auth.js';

describe('tailscale-auth', () => {
  it('allows identity auth only for serve mode', () => {
    const cfg = {
      gateway: {
        tailscale: { mode: 'serve' },
        auth: { mode: 'token' },
      },
    } as Config;
    expect(shouldAllowTailscaleIdentityAuth(cfg)).toBe(true);
  });

  it('detects serve proxy headers from loopback', () => {
    expect(
      isTailscaleServeRequest({
        remoteAddress: '127.0.0.1',
        headers: {
          forwardedFor: '100.64.0.2',
          forwardedProto: 'https',
          forwardedHost: 'machine.tailnet.ts.net',
          tailscaleUserLogin: 'user@example.com',
        },
      }),
    ).toBe(true);
  });

  it('limits ui bypass paths', () => {
    expect(isTailscaleUiBypassPath('/')).toBe(true);
    expect(isTailscaleUiBypassPath('/assets/app.js')).toBe(true);
    expect(isTailscaleUiBypassPath('/api/status')).toBe(false);
  });
});
