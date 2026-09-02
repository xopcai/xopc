// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/features/preview-runtime', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/features/preview-runtime')>(),
  PreviewRuntimeToolbar: () => null,
  PreviewRuntimeView: () => null,
}));

import { AttachmentPreviewDialog } from '../attachment-preview-dialog';
import { useLocaleStore } from '@/stores/locale-store';

describe('AttachmentPreviewDialog local spreadsheet action', () => {
  let container: HTMLDivElement;
  let root: Root;

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

    const button = document.querySelector<HTMLButtonElement>('[aria-label="Open in local app"]');
    expect(button).not.toBeNull();

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

    expect(document.querySelector('[aria-label="Open in local app"]')).toBeNull();
  });
});
