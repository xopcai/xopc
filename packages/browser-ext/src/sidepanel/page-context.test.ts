import { afterEach, describe, expect, it, vi } from 'vitest';

import { captureContextMenuSelection, captureTabWithPermission } from './page-context';

function stubChrome(options: {
  alreadyGranted: boolean;
  requestGranted?: boolean;
  tabUrl?: string;
  executeError?: Error;
}) {
  const messages: Record<string, string> = {
    errorSiteAccessRequired: 'Allow xopc to access $1 to continue.',
    errorSiteAccessBlocked: "Chrome blocked access to $1. Check xopc's site access for this page and try again.",
    errorRestrictedPage: 'Chrome does not allow xopc to read this page. Open a regular http(s) page and try again.',
    errorSelectText: 'Select text on the page first',
    errorNoReadableContent: 'No readable text was found. Select text or attach a screenshot instead.',
  };
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
    i18n: {
      getMessage: vi.fn((key: string, substitutions?: string | string[]) => {
        const values = typeof substitutions === 'string' ? [substitutions] : substitutions ?? [];
        return (messages[key] ?? key).replace(/\$(\d+)/g, (_match, index) => values[Number(index) - 1] ?? '');
      }),
    },
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
  it('captures with installation permissions without requesting site access', async () => {
    const { executeScript, remove, request } = stubChrome({ alreadyGranted: false });

    const context = await captureTabWithPermission(7, 'page');

    expect(context).toMatchObject({ kind: 'browser_page', title: 'Example', text: 'Page body' });
    expect(executeScript).toHaveBeenCalledWith(expect.objectContaining({ target: { tabId: 7, allFrames: true } }));
    expect(request).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it('preserves a permission that was already granted', async () => {
    const { remove, request } = stubChrome({ alreadyGranted: true });

    await captureTabWithPermission(7, 'page');

    expect(request).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it('reports withheld Chrome access without revoking permissions', async () => {
    const { remove } = stubChrome({
      alreadyGranted: false,
      executeError: new Error('Cannot access contents of url "https://example.com/article"'),
    });

    await expect(captureTabWithPermission(7, 'page'))
      .rejects.toThrow("Check xopc's site access");
    expect(remove).not.toHaveBeenCalled();
  });

  it('rejects browser-internal pages before requesting access', async () => {
    const { executeScript, request } = stubChrome({ alreadyGranted: false, tabUrl: 'chrome://extensions/' });

    await expect(captureTabWithPermission(7, 'page'))
      .rejects.toThrow('regular http(s) page');
    expect(request).not.toHaveBeenCalled();
    expect(executeScript).not.toHaveBeenCalled();
  });

  it('uses the context-menu selection without injecting into the page', async () => {
    const { executeScript, request } = stubChrome({ alreadyGranted: false });
    const context = await captureContextMenuSelection(7, '  selected\n text  ', 'https://example.com/article');

    expect(context).toMatchObject({ title: 'example.com', selection: 'selected text' });
    expect(executeScript).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it('reads a selection from a permitted child frame', async () => {
    const { executeScript } = stubChrome({ alreadyGranted: true });
    executeScript.mockResolvedValueOnce([
      { result: { title: 'Article', url: 'https://example.com/article', timeOrigin: 123, selection: '' } },
      { result: { title: 'Frame', url: 'https://example.com/frame', timeOrigin: 456, selection: 'quoted passage' } },
    ]);

    const context = await captureTabWithPermission(7, 'selection');

    expect(context.selection).toBe('quoted passage');
    expect(context.url).toBe('https://example.com/article');
    expect(executeScript).toHaveBeenCalledWith(expect.objectContaining({ target: { tabId: 7, allFrames: true } }));
  });

  it('reads a permitted frame when the main page has no text', async () => {
    const { executeScript } = stubChrome({ alreadyGranted: true });
    executeScript.mockResolvedValueOnce([
      { result: { title: 'Article', url: 'https://example.com/article', timeOrigin: 123, text: '' } },
      { result: { title: 'Frame', url: 'https://example.com/frame', timeOrigin: 456, text: 'Embedded article' } },
    ]);

    const context = await captureTabWithPermission(7, 'page');

    expect(context).toMatchObject({ title: 'Article', url: 'https://example.com/article', text: 'Embedded article' });
  });

  it('reads an explicitly selected range from a text field', async () => {
    const { executeScript } = stubChrome({ alreadyGranted: true });
    class TextField {
      type = 'text';
      value = 'before selected after';
      selectionStart = 7;
      selectionEnd = 15;
    }
    vi.stubGlobal('HTMLInputElement', TextField);
    vi.stubGlobal('HTMLTextAreaElement', class {});
    vi.stubGlobal('document', { activeElement: new TextField(), title: 'Example' });
    vi.stubGlobal('window', { getSelection: () => ({ toString: () => '' }) });
    vi.stubGlobal('location', { href: 'https://example.com/article' });
    executeScript.mockImplementationOnce(async ({ func, args }) => [{ result: func(...args) }]);

    const context = await captureTabWithPermission(7, 'selection');

    expect(context.selection).toBe('selected');
  });

  it('explains when no page text is available', async () => {
    const { executeScript } = stubChrome({ alreadyGranted: true });
    executeScript.mockResolvedValueOnce([{ result: { title: 'Empty', url: 'https://example.com/article', timeOrigin: 123 } }]);

    await expect(captureTabWithPermission(7, 'page')).rejects.toThrow('No readable text was found');
  });

  it('rejects content captured during a same-origin navigation', async () => {
    stubChrome({ alreadyGranted: true });
    vi.mocked(chrome.tabs.get)
      .mockResolvedValueOnce({ id: 7, windowId: 1, url: 'https://example.com/article' } as chrome.tabs.Tab)
      .mockResolvedValueOnce({ id: 7, windowId: 1, url: 'https://example.com/article' } as chrome.tabs.Tab)
      .mockResolvedValueOnce({ id: 7, windowId: 1, url: 'https://example.com/next' } as chrome.tabs.Tab);

    await expect(captureTabWithPermission(7, 'page')).rejects.toThrow('errorPageChangedReading');
  });
});
