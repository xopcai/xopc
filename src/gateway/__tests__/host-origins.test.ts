import { describe, expect, it } from 'vitest';

import {
  originFromGatewayPublicUrl,
  resolveAllowedBrowserOrigins,
} from '../host.js';

describe('originFromGatewayPublicUrl', () => {
  it('extracts origin from tunnel root URL', () => {
    expect(originFromGatewayPublicUrl('https://wxfy4i.frp.xopc.ai/')).toBe(
      'https://wxfy4i.frp.xopc.ai',
    );
  });
});

describe('resolveAllowedBrowserOrigins', () => {
  it('merges tunnel public URL into the allowlist', () => {
    const origins = resolveAllowedBrowserOrigins({
      configuredOrigins: ['http://localhost:18790'],
      port: 18790,
      tunnelPublicUrl: 'https://abc.frp.xopc.ai',
    });
    expect(origins).toContain('http://localhost:18790');
    expect(origins).toContain('https://abc.frp.xopc.ai');
  });
});
