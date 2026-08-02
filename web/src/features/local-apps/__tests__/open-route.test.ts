import { describe, expect, it } from 'vitest';

import { localAppOpenRoute } from '../open-route';

const app = {
  id: 'draft/reading list',
  extensionId: 'reading-list',
  installationState: 'not_installed' as const,
  enabled: false,
  status: 'preview_ready' as const,
};

describe('localAppOpenRoute', () => {
  it('opens an enabled installed app in its runtime page', () => {
    expect(localAppOpenRoute({
      ...app,
      installationState: 'installed',
      enabled: true,
      status: 'installed',
    })).toBe('/extensions/reading-list');
  });

  it('opens drafts and disabled apps in the workbench', () => {
    expect(localAppOpenRoute(app)).toBe('/local-apps/draft%2Freading%20list');
    expect(localAppOpenRoute({
      ...app,
      installationState: 'installed',
      enabled: false,
      status: 'installed',
    })).toBe('/local-apps/draft%2Freading%20list');
    expect(localAppOpenRoute({
      ...app,
      installationState: 'installed',
      enabled: true,
      status: 'degraded',
    })).toBe('/local-apps/draft%2Freading%20list');
  });
});
