import { describe, expect, it } from 'vitest';

import type { Config } from '../config/schema.js';
import { collectExposureConflicts, isRemoteGatewayInsecure } from './exposure-guards.js';

describe('exposure-guards', () => {
  it('flags tailscale serve with lan bind', () => {
    const cfg = {
      gateway: {
        bind: 'lan',
        tailscale: { mode: 'serve' },
      },
    } as Config;
    const conflicts = collectExposureConflicts(cfg);
    expect(conflicts.some((c) => c.code === 'tailscale_non_loopback_bind')).toBe(true);
  });

  it('flags funnel without password', () => {
    const cfg = {
      gateway: {
        bind: 'loopback',
        auth: { mode: 'token', token: 'x'.repeat(32) },
        tailscale: { mode: 'funnel' },
      },
    } as Config;
    const conflicts = collectExposureConflicts(cfg);
    expect(conflicts.some((c) => c.code === 'funnel_without_password')).toBe(true);
  });

  it('flags tailscale and frp autostart conflict', () => {
    const cfg = {
      gateway: {
        bind: 'loopback',
        tailscale: { mode: 'serve' },
      },
      tunnel: { autoStart: true },
    } as Config;
    const conflicts = collectExposureConflicts(cfg);
    expect(conflicts.some((c) => c.code === 'tailscale_frp_autostart_conflict')).toBe(true);
  });

  it('detects insecure remote gateway url', () => {
    const cfg = {
      gateway: {
        mode: 'remote',
        remote: { url: 'http://203.0.113.1:18790' },
      },
    } as Config;
    expect(isRemoteGatewayInsecure(cfg)).toBe(true);
  });
});
