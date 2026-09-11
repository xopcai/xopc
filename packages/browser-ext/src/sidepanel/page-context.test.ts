import { afterEach, describe, expect, it, vi } from 'vitest';

import { captureTabWithPermission } from './page-context';

function stubChrome(options: {
  alreadyGranted: boolean;
  requestGranted?: boolean;
  tabUrl?: string;
  executeError?: Error;
}) {
  const remove = vi.fn().mockResolvedValue(true);
  const request = vi.fn().mockResolvedValue(options.requestGranted ?? true);
  const executeScript = options.executeError
    ? vi.fn().mockRejectedValue(options.executeError)
    : vi.fn().mockResolvedValue([{
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
      request,
      remove,
    },
    tabs: {
      get: vi.fn().mockResolvedValue({ id: 7, windowId: 1, url: options.tabUrl ?? 'https://example.com/article' }),
    },
    scripting: { executeScript },
  });
  return { executeScript, remove, request };
}

afterEach(() => vi.unstubAllGlobals());

describe('captureTabWithPermission', () => {
  it('requests and retains a site permission after a successful capture', async () => {
    const { executeScript, remove, request } = stubChrome({ alreadyGranted: false });

    const context = await captureTabWithPermission(7, 'page');

    expect(context).toMatchObject({ kind: 'browser_page', title: 'Example', text: 'Page body' });
    expect(executeScript).toHaveBeenCalledWith(expect.objectContaining({ target: { tabId: 7 } }));
    expect(request).toHaveBeenCalledWith({ origins: ['https://example.com/*'] });
    expect(remove).not.toHaveBeenCalled();
  });

  it('does not capture when site access is denied', async () => {
    const { executeScript, remove } = stubChrome({ alreadyGranted: false, requestGranted: false });

    await expect(captureTabWithPermission(7, 'page'))
      .rejects.toThrow('Allow xopc to access example.com');
    expect(executeScript).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it('preserves a permission that was already granted', async () => {
    const { remove, request } = stubChrome({ alreadyGranted: true });

    await captureTabWithPermission(7, 'page');

    expect(request).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it('removes a newly granted permission if capture fails', async () => {
    const { remove } = stubChrome({
      alreadyGranted: false,
      executeError: new Error('Cannot access contents of url "https://example.com/article"'),
    });

    await expect(captureTabWithPermission(7, 'page'))
      .rejects.toThrow("Check xopc's site access");
    expect(remove).toHaveBeenCalledWith({ origins: ['https://example.com/*'] });
  });

  it('rejects browser-internal pages before requesting access', async () => {
    const { executeScript, request } = stubChrome({ alreadyGranted: false, tabUrl: 'chrome://extensions/' });

    await expect(captureTabWithPermission(7, 'page'))
      .rejects.toThrow('regular http(s) page');
    expect(request).not.toHaveBeenCalled();
    expect(executeScript).not.toHaveBeenCalled();
  });
});
