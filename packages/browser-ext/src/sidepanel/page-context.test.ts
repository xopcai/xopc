import { afterEach, describe, expect, it, vi } from 'vitest';

import { captureTabWithPermission } from './page-context';

function stubChrome(options: { alreadyGranted: boolean; requestGranted?: boolean }) {
  const remove = vi.fn().mockResolvedValue(true);
  const executeScript = vi.fn().mockResolvedValue([{
    result: {
      title: 'Example',
      url: 'https://example.com/article',
      timeOrigin: 123,
      text: 'Page body',
    },
  }]);
  vi.stubGlobal('chrome', {
    permissions: {
      contains: vi.fn().mockResolvedValue(options.alreadyGranted),
      request: vi.fn().mockResolvedValue(options.requestGranted ?? true),
      remove,
    },
    tabs: {
      get: vi.fn().mockResolvedValue({ id: 7, url: 'https://example.com/article' }),
    },
    scripting: { executeScript },
  });
  return { executeScript, remove };
}

afterEach(() => vi.unstubAllGlobals());

describe('captureTabWithPermission', () => {
  it('removes an origin permission granted only for capture', async () => {
    const { executeScript, remove } = stubChrome({ alreadyGranted: false });

    const context = await captureTabWithPermission(7, 'https://example.com/article', 'page');

    expect(context).toMatchObject({ kind: 'browser_page', title: 'Example', text: 'Page body' });
    expect(executeScript).toHaveBeenCalledWith(expect.objectContaining({ target: { tabId: 7 } }));
    expect(remove).toHaveBeenCalledWith({ origins: ['https://example.com/*'] });
  });

  it('does not capture when site access is denied', async () => {
    const { executeScript, remove } = stubChrome({ alreadyGranted: false, requestGranted: false });

    await expect(captureTabWithPermission(7, 'https://example.com/article', 'page'))
      .rejects.toThrow('Site access is required');
    expect(executeScript).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it('preserves a permission that was already granted', async () => {
    const { remove } = stubChrome({ alreadyGranted: true });

    await captureTabWithPermission(7, 'https://example.com/article', 'page');

    expect(remove).not.toHaveBeenCalled();
  });
});
