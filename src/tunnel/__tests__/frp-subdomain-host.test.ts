import { describe, expect, it } from 'vitest';

import { resolveFrpSubdomainHost } from '../frp-subdomain-host.js';

describe('tunnel transport config', () => {
  it('resolveFrpSubdomainHost from production broker URL', () => {
    expect(resolveFrpSubdomainHost('https://frp.xopc.ai/api')).toBe('frp.xopc.ai');
  });

  it('resolveFrpSubdomainHost from custom host', () => {
    expect(resolveFrpSubdomainHost('https://tunnel.example.com/api')).toBe('tunnel.example.com');
  });
});
