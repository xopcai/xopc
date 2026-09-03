// @vitest-environment jsdom

import { act, type ComponentProps } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/features/preview-runtime/preview-runtime', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/features/preview-runtime/preview-runtime')>(),
  PreviewRuntimeView: vi.fn(() => null),
}));

vi.mock('@/features/preview-runtime/media-fetch', () => ({ fetchMediaUriBuffer: vi.fn() }));

vi.mock('@/features/shares/shares-api', () => ({ createShare: vi.fn() }));

import { PreviewRuntimeView } from '@/features/preview-runtime/preview-runtime';
import { createShare } from '@/features/shares/shares-api';
import { AttachmentPreviewDialog as AttachmentPreviewDialogUnderTest } from '../attachment-preview-dialog';
import { messages } from '@/i18n/messages';
import { fetchMediaUriBuffer } from '@/features/preview-runtime/media-fetch';
import { useLocaleStore } from '@/stores/locale-store';

function AttachmentPreviewDialog(props: ComponentProps<typeof AttachmentPreviewDialogUnderTest>) {
  return <MemoryRouter><AttachmentPreviewDialogUnderTest {...props} /></MemoryRouter>;
}

describe('AttachmentPreviewDialog shared header', () => {
  let container: HTMLDivElement;
  let root: Root;

  const labels = messages('en').workspace;
  const openMenu = () => act(() => document.querySelector<HTMLButtonElement>(`[aria-label="${labels.moreActions}"]`)?.click());
  const menuItem = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((button) => button.textContent === label);

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    useLocaleStore.setState({ language: 'en' });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: undefined,
      writable: true,
    });
    vi.restoreAllMocks();
  });

  it('opens the already-loaded workbook through the Electron bridge', async () => {
    const openTemporaryFile = vi.fn(async (_input: { fileName: string; data: Uint8Array }) => ({
      ok: true as const,
    }));
    window.electronAPI = {
      shell: { openTemporaryFile },
    } as unknown as Window['electronAPI'];
    const attachment = {
      id: 'sheet-1',
      name: 'sales.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      size: 3,
      data: 'AQID',
    };

    act(() => {
      root.render(<AttachmentPreviewDialog open={false} attachment={attachment} onClose={vi.fn()} />);
    });
    await act(async () => {
      root.render(
        <AttachmentPreviewDialog
          open
          attachment={attachment}
          onClose={vi.fn()}
        />,
      );
    });

    expect(menuItem(labels.openSystemApp)).toBeUndefined();
    openMenu();
    const button = menuItem(labels.openSystemApp);
    expect(button).toBeDefined();

    await act(async () => button?.click());

    expect(openTemporaryFile).toHaveBeenCalledTimes(1);
    const input = openTemporaryFile.mock.calls[0]?.[0];
    expect(input?.fileName).toBe('sales.xlsx');
    expect([...(input?.data ?? [])]).toEqual([1, 2, 3]);
  });

  it('does not show the local action in the browser build', async () => {
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: undefined,
      writable: true,
    });

    const attachment = {
      name: 'sales.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      data: 'AQID',
    };
    act(() => {
      root.render(<AttachmentPreviewDialog open={false} attachment={attachment} onClose={vi.fn()} />);
    });
    await act(async () => {
      root.render(
        <AttachmentPreviewDialog
          open
          attachment={attachment}
          onClose={vi.fn()}
        />,
      );
    });

    openMenu();
    expect(menuItem(labels.openSystemApp)).toBeUndefined();
    expect(menuItem(labels.download)).toBeDefined();
  });


  it('downloads the original bytes of a URI-backed Markdown attachment', async () => {
    const content = '# 标题\r\nOriginal text\r\n';
    vi.mocked(fetchMediaUriBuffer).mockResolvedValue({
      ok: true,
      buffer: new TextEncoder().encode(content).buffer,
    });
    const createObjectURL = vi.fn((_blob: Blob) => 'blob:download');
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    await act(async () => root.render(<AttachmentPreviewDialog open authToken="token" sessionKey="session-a"
      attachment={{ name: 'report.md', uri: 'media://outbound/report.md', mimeType: 'text/markdown' }} onClose={vi.fn()} />));
    openMenu();
    const download = menuItem(labels.download);
    expect(download?.disabled).toBe(false);
    await act(async () => download?.click());
    expect(createObjectURL).toHaveBeenCalledOnce();
    const blob = createObjectURL.mock.calls[0][0];
    const downloaded = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsText(blob);
    });
    expect(downloaded).toBe(content);
  });

  it.each([
    { uri: 'media://outbound/index.html', expected: { uri: 'media://outbound/index.html', sessionKey: 'session-a' } },
    { uri: 'xopc-file:project-file', expected: { fileId: 'project-file' } },
  ])('shares a delivered HTML file after confirmation ($uri)', async ({ uri, expected }) => {
    vi.mocked(fetchMediaUriBuffer).mockResolvedValue({ ok: true, buffer: new TextEncoder().encode('<h1>Report</h1>').buffer });
    vi.mocked(createShare).mockReset();
    vi.mocked(createShare).mockRejectedValue(new Error('Test response'));
    await act(async () => root.render(<AttachmentPreviewDialog open authToken="token" sessionKey="session-a"
      attachment={{ name: 'index.html', uri, mimeType: 'text/html' }} onClose={vi.fn()} />));
    const button = document.querySelector<HTMLButtonElement>(`[aria-label="${labels.shareLink}"]`);
    expect(button).not.toBeNull();
    await act(async () => button?.click());
    expect(createShare).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain(messages('en').sharesSettings.shareConfirmTitle);
    await act(async () => document.querySelector<HTMLButtonElement>('button[type="submit"]')?.click());
    expect(createShare).toHaveBeenCalledWith(expect.objectContaining({ ...expected, fileName: 'index.html' }));
  });

  it('switches extracted text through the common header controls', async () => {
    await act(async () => root.render(<AttachmentPreviewDialog open
      attachment={{ name: 'report.pdf', mimeType: 'application/pdf', data: 'AQID', extractedText: 'Report text' }} onClose={vi.fn()} />));
    const textLabel = messages('en').chat.attachmentPreviewText;
    const textButton = [...document.querySelectorAll<HTMLButtonElement>('[role="group"] button')].find((button) => button.textContent === textLabel);
    expect(textButton).toBeDefined();
    act(() => textButton?.click());
    expect(vi.mocked(PreviewRuntimeView).mock.lastCall?.[0]).toMatchObject({ showExtractedText: true, extractedText: 'Report text' });
  });

  it('keeps image zoom in the shared header without a second download action', async () => {
    await act(async () => root.render(<AttachmentPreviewDialog open
      attachment={{ name: 'image.png', mimeType: 'image/png', data: 'AQID' }} onClose={vi.fn()} />));
    expect(document.body.textContent).toContain('100%');
    act(() => document.querySelector<HTMLButtonElement>('[aria-label="Zoom in"]')?.click());
    expect(document.body.textContent).toContain('115%');
    expect(document.querySelector('[aria-label="Download"]')).toBeNull();
    openMenu();
    expect(menuItem(labels.download)?.disabled).toBe(false);
  });

  it('disables download when inline data cannot be decoded', async () => {
    await act(async () => root.render(<AttachmentPreviewDialog open
      attachment={{ name: 'report.xlsx', data: 'invalid base64!' }} onClose={vi.fn()} />));
    openMenu();
    expect(menuItem(labels.download)?.disabled).toBe(true);
  });

  it('collapses the preview on Escape before closing the dialog', async () => {
    const onClose = vi.fn();
    await act(async () => root.render(<AttachmentPreviewDialog open
      attachment={{ name: 'report.xlsx', data: 'AQID' }} onClose={onClose} />));
    act(() => document.querySelector<HTMLButtonElement>(`[aria-label="${labels.expandPreview}"]`)?.click());
    expect(document.querySelector(`[aria-label="${labels.collapsePreview}"]`)).not.toBeNull();
    openMenu();
    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(document.querySelector(`[aria-label="${labels.collapsePreview}"]`)).not.toBeNull();
    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    expect(document.querySelector(`[aria-label="${labels.expandPreview}"]`)).not.toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    act(() => document.querySelector<HTMLButtonElement>(`[aria-label="${labels.close}"]`)?.click());
    expect(onClose).toHaveBeenCalledOnce();
  });
});
