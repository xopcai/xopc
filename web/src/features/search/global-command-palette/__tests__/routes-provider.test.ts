// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import { buildRouteSeeds } from '@/features/search/global-command-palette/routes-provider';

const previousApi = window.electronAPI;
afterEach(() => { window.electronAPI = previousApi; });

describe('buildRouteSeeds', () => {
  it('finds the dedicated computer use settings page', () => {
    window.electronAPI = { platform: 'darwin' } as Window['electronAPI'];
    const computer = buildRouteSeeds('zh').find(s => s.path === '/settings/computer-use');
    expect(computer).toBeDefined();
    expect(computer?.keywords).toContain('电脑操作');
  });
  it.each(['win32', 'linux', undefined])('hides computer use search on %s but preserves browser automation', (platform) => {
    window.electronAPI = platform ? { platform } as Window['electronAPI'] : undefined;
    const seeds = buildRouteSeeds('zh');
    expect(seeds.find(seed => seed.path === '/settings/computer-use')).toBeUndefined();
    expect(seeds.find(seed => seed.path === '/settings/agent-browser')).toBeDefined();
  });
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

  it('links every capability result to its dedicated route', () => {
    const seeds = buildRouteSeeds('en');
    expect(seeds.find((s) => s.id === 'route:settings:capabilities')).toBeUndefined();
    expect(seeds.find((s) => s.id === 'route:settings:capabilities:models')?.path).toBe(
      '/settings/capabilities/models',
    );
    expect(seeds.find((s) => s.id === 'route:settings:capabilities:image')?.path).toBe(
      '/settings/capabilities/image',
    );
    expect(seeds.find((s) => s.id === 'route:settings:capabilities:voice')?.path).toBe(
      '/settings/capabilities/voice',
    );
    expect(seeds.find((s) => s.id === 'route:settings:capabilities:search')?.path).toBe(
      '/settings/capabilities/search',
    );
    expect(
      seeds
        .filter((s) => s.id.startsWith('route:settings:capabilities'))
        .every((s) => s.path.startsWith('/settings/capabilities/')),
    ).toBe(true);
  });
});
