import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { captureVisibleScreenshot, fileToBrowserAttachment } from './attachments';

const messages: Record<string, string> = {
  errorActiveTabChanged: 'The active tab changed. Try the screenshot again.',
  errorScreenshotPermissionRequired: 'Screenshot permission required',
  errorUnsupportedAttachment: 'Attach an image, PDF, text, Markdown, JSON, or CSV file',
};

function i18n() {
  return { getMessage: (key: string) => messages[key] ?? key };
}

beforeEach(() => vi.stubGlobal('chrome', { i18n: i18n() }));

afterEach(() => vi.unstubAllGlobals());

describe('captureVisibleScreenshot', () => {
  it('requests all URLs synchronously before capturing from the side panel', async () => {
    const request = vi.fn().mockResolvedValue(true);
    const captureVisibleTab = vi.fn().mockResolvedValue('data:image/png;base64,AAAA');
    vi.stubGlobal('chrome', {
      i18n: i18n(),
      permissions: {
        contains: vi.fn().mockResolvedValue(true),
        request,
        remove: vi.fn().mockResolvedValue(true),
      },
      tabs: {
        query: vi.fn().mockResolvedValue([{ id: 7, windowId: 2, url: 'https://xopc.ai/zh' }]),
        get: vi.fn().mockResolvedValue({ id: 7, windowId: 2, url: 'https://xopc.ai/zh' }),
        captureVisibleTab,
      },
    });

    const pending = captureVisibleScreenshot();

    expect(request).toHaveBeenCalledWith({ origins: ['<all_urls>'] });
    const screenshot = await pending;

    expect(request).toHaveBeenCalledTimes(1);
    expect(captureVisibleTab).toHaveBeenCalledWith(2, { format: 'png' });
    expect(screenshot).toMatchObject({ type: 'image', mimeType: 'image/png' });
  });

  it('does not capture a different tab after the permission prompt', async () => {
    const remove = vi.fn().mockResolvedValue(true);
    const query = vi.fn()
      .mockResolvedValueOnce([{ id: 7, windowId: 2, url: 'https://xopc.ai/zh' }])
      .mockResolvedValueOnce([{ id: 8, windowId: 2, url: 'https://example.com' }]);
    vi.stubGlobal('chrome', {
      i18n: i18n(),
      permissions: {
        contains: vi.fn().mockResolvedValue(true),
        request: vi.fn().mockResolvedValue(true),
        remove,
      },
      tabs: {
        query,
        get: vi.fn().mockResolvedValue({ id: 7, windowId: 2, url: 'https://xopc.ai/zh' }),
        captureVisibleTab: vi.fn(),
      },
    });

    await expect(captureVisibleScreenshot()).rejects.toThrow('active tab changed');
    expect(chrome.tabs.captureVisibleTab).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it('does not capture when screenshot permission is denied', async () => {
    const captureVisibleTab = vi.fn();
    vi.stubGlobal('chrome', {
      i18n: i18n(),
      permissions: { request: vi.fn().mockResolvedValue(false) },
      tabs: {
        query: vi.fn().mockResolvedValue([{ id: 7 }]),
        captureVisibleTab,
      },
    });

    await expect(captureVisibleScreenshot()).rejects.toThrow('Screenshot permission required');
    expect(captureVisibleTab).not.toHaveBeenCalled();
  });

  it('handles an empty active tab query', async () => {
    vi.stubGlobal('chrome', {
      i18n: i18n(),
      permissions: { request: vi.fn().mockResolvedValue(true) },
      tabs: { query: vi.fn().mockResolvedValue([]) },
    });

    await expect(captureVisibleScreenshot()).rejects.toThrow('errorNoActivePage');
  });
});

describe('fileToBrowserAttachment', () => {
  it('accepts supported files whose browser omits a MIME type', async () => {
    const attachment = await fileToBrowserAttachment(new File(['# Notes'], 'notes.md'));

    expect(attachment).toMatchObject({ type: 'file', name: 'notes.md', size: 7 });
  });

  it('rejects unsupported dragged or pasted files', async () => {
    await expect(fileToBrowserAttachment(new File(['binary'], 'archive.zip', {
      type: 'application/zip',
    }))).rejects.toThrow('image, PDF, text, Markdown, JSON, or CSV');
  });
});

describe('document support', () => {
  it.each([
    ['report.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ['sheet.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    ['slides.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
    ['script.ts', 'text/plain'],
  ])('infers MIME for %s when the browser omits it', async (name, mimeType) => {
    const attachment = await fileToBrowserAttachment(new File(['data'], name));
    expect(attachment.mimeType).toBe(mimeType);
    expect(attachment.name).toBe(name);
  });
});
