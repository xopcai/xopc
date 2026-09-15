// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/features/chat/attachments/attachment-preview-renderer', () => ({
  renderPdfInContainer: vi.fn(),
}));
import { renderPdfInContainer } from '@/features/chat/attachments/attachment-preview-renderer';
import { PdfPreviewPluginView } from '@/features/preview-runtime/plugins/binary-plugins';
import type { PreviewRuntimeRenderProps } from '@/features/preview-runtime/preview-types';

const renderPdf = vi.mocked(renderPdfInContainer);
const propsFor = (id: string): PreviewRuntimeRenderProps => ({
  descriptor: { id, fileName: `${id}.pdf`, mimeType: 'application/pdf', type: 'pdf', context: 'attachment', source: { kind: 'inline' } },
  binaryBuffer: new ArrayBuffer(4), textContent: null, loading: false, loadError: null,
  language: 'en', actions: { onDownload: vi.fn(), canDownload: true },
});

describe('binary preview lifecycle', () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
    renderPdf.mockReset();
  });
  afterEach(() => { act(() => root.unmount()); host.remove(); });

  it('keeps a rendering failure visible instead of remounting and retrying', async () => {
    renderPdf.mockRejectedValueOnce(new Error('PDF worker failed'));
    renderPdf.mockImplementation(() => new Promise(() => {}));
    await act(async () => root.render(<PdfPreviewPluginView {...propsFor('broken')} />));
    expect(host.textContent).toContain('PDF worker failed');
    expect(renderPdf).toHaveBeenCalledTimes(1);
  });

  it('cleans up a late render without overwriting the next document', async () => {
    let completeFirst!: (result: { cleanup: () => void }) => void;
    let firstHost!: HTMLDivElement;
    const firstCleanup = vi.fn(() => { firstHost.innerHTML = ''; });
    const secondCleanup = vi.fn();
    renderPdf.mockImplementationOnce(container => {
      firstHost = container;
      return new Promise(resolve => { completeFirst = resolve; });
    });
    renderPdf.mockImplementationOnce(async container => {
      container.textContent = 'Second PDF';
      return { cleanup: secondCleanup };
    });
    await act(async () => root.render(<PdfPreviewPluginView {...propsFor('first')} />));
    await act(async () => root.render(<PdfPreviewPluginView {...propsFor('second')} />));
    await act(async () => { firstHost.textContent = 'Stale first PDF'; completeFirst({ cleanup: firstCleanup }); });
    expect(host.textContent).toContain('Second PDF');
    expect(host.textContent).not.toContain('Stale first PDF');
    expect(firstCleanup).toHaveBeenCalledOnce();
    act(() => root.render(null));
    expect(secondCleanup).toHaveBeenCalledOnce();
  });

  it('recovers when a different PDF is opened after a failure', async () => {
    renderPdf.mockRejectedValueOnce(new Error('Invalid PDF'));
    await act(async () => root.render(<PdfPreviewPluginView {...propsFor('broken')} />));
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('Invalid PDF');
    renderPdf.mockImplementationOnce(async container => {
      container.textContent = 'Valid PDF';
      return { cleanup: vi.fn() };
    });
    await act(async () => root.render(<PdfPreviewPluginView {...propsFor('valid')} />));
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.textContent).toContain('Valid PDF');
    expect(renderPdf).toHaveBeenCalledTimes(2);
  });
});
