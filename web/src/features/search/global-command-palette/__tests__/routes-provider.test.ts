import { describe, expect, it } from 'vitest';

import { buildRouteSeeds } from '@/features/search/global-command-palette/routes-provider';

describe('buildRouteSeeds', () => {
  it('maps browser settings to the standalone browser route', () => {
    const seeds = buildRouteSeeds('en');
    const browser = seeds.find((s) => s.id === 'route:settings:agent:settingsAgentBrowser');
    expect(browser?.path).toBe('/settings/agent-browser');
    expect(browser?.keywords).toContain('browser');
  });

  it('offers the app workshop as a searchable route', () => {
    const seeds = buildRouteSeeds('en');
    const workshop = seeds.find((s) => s.id === 'route:local-apps');
    expect(workshop?.path).toBe('/local-apps');
    expect(workshop?.keywords).toContain('workshop');
  });
});
