// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ fetchJson: vi.fn() }));
vi.mock('@/lib/fetch', () => ({ fetchJson: mocks.fetchJson }));

import {
  confirmExtensionUiGrant,
  resolveExtensionUiGrant,
} from '../extension-authoritative-grants';

describe('authoritative extension grants', () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.fetchJson.mockReset();
  });

  it('uses the server decision for every extension', async () => {
    mocks.fetchJson.mockResolvedValue({
      grant: { granted: false, extensionId: 'local-app', appId: 'app-1', permissions: ['theme'] },
    });

    expect(await resolveExtensionUiGrant('local-app')).toMatchObject({
      granted: false,
      extensionId: 'local-app',
      appId: 'app-1',
    });
  });

  it('persists confirmation through the authenticated API', async () => {
    mocks.fetchJson.mockResolvedValue({
      grant: { granted: true, extensionId: 'local-app', appId: 'app-1', permissions: ['theme'] },
    });

    const grant = await confirmExtensionUiGrant('local-app');

    expect(grant.granted).toBe(true);
    expect(mocks.fetchJson).toHaveBeenCalledWith(
      expect.stringContaining('/api/extensions/local-app/ui-grant'),
      { method: 'POST' },
    );
  });
});
