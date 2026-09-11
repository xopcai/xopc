import { afterEach, describe, expect, it, vi } from 'vitest';

import { captureVisibleScreenshot, fileToBrowserAttachment } from './attachments';

afterEach(() => vi.unstubAllGlobals());

describe('captureVisibleScreenshot', () => {
  it('requests access to the active site before capturing it', async () => {
    const request = vi.fn().mockResolvedValue(true);
    const captureVisibleTab = vi.fn().mockResolvedValue('data:image/png;base64,AAAA');
    vi.stubGlobal('chrome', {
      permissions: {
        contains: vi.fn().mockResolvedValue(false),
        request,
        remove: vi.fn().mockResolvedValue(true),
      },
      tabs: {
        query: vi.fn().mockResolvedValue([{ id: 7, windowId: 2, url: 'https://xopc.ai/zh' }]),
        get: vi.fn().mockResolvedValue({ id: 7, windowId: 2, url: 'https://xopc.ai/zh' }),
        captureVisibleTab,
      },
    });

    const screenshot = await captureVisibleScreenshot();

    expect(request).toHaveBeenCalledWith({ origins: ['https://xopc.ai/*'] });
    expect(captureVisibleTab).toHaveBeenCalledWith(2, { format: 'png' });
    expect(screenshot).toMatchObject({ type: 'image', mimeType: 'image/png' });
  });

  it('does not capture a different tab after the permission prompt', async () => {
    const remove = vi.fn().mockResolvedValue(true);
    const query = vi.fn()
      .mockResolvedValueOnce([{ id: 7, windowId: 2, url: 'https://xopc.ai/zh' }])
      .mockResolvedValueOnce([{ id: 8, windowId: 2, url: 'https://example.com' }]);
    vi.stubGlobal('chrome', {
      permissions: {
        contains: vi.fn().mockResolvedValue(false),
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
    expect(remove).toHaveBeenCalledWith({ origins: ['https://xopc.ai/*'] });
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
