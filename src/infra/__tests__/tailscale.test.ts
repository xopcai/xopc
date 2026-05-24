import { describe, expect, it, beforeEach } from 'vitest';

import { resetTailscaleBinaryCacheForTest, getTailnetIPv4Sync } from '../tailscale.js';

describe('tailscale infra', () => {
  beforeEach(() => {
    resetTailscaleBinaryCacheForTest();
    delete process.env.XOPC_TEST_TAILSCALE_BINARY;
  });

  it('returns undefined when tailscale is not available', () => {
    process.env.XOPC_TEST_TAILSCALE_BINARY = '/nonexistent/tailscale';
    process.env.VITEST = 'true';
    expect(getTailnetIPv4Sync()).toBeUndefined();
  });
});
