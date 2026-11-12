// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../pdf-runtime', () => ({ ensurePdfWorker: vi.fn() }));
import { ensurePdfWorker } from '../pdf-runtime';
import { renderPdfInContainer } from '../attachment-preview-renderer';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('PDF preview buffer ownership', () => {
  it('preserves source bytes when the worker transfers data, including on a second preview', async () => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1; });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ fillRect: vi.fn() } as unknown as CanvasRenderingContext2D);
    const destroy = vi.fn(async () => {});
    const getDocument = vi.fn(({ data }: { data: ArrayBuffer }) => {
      structuredClone(data, { transfer: [data] });
      return { destroy, promise: Promise.resolve({ numPages: 1, getPage: async () => ({
        getViewport: () => ({ width: 30, height: 30 }),
        render: () => ({ promise: Promise.resolve() }),
      }) }) };
    });
    vi.mocked(ensurePdfWorker).mockResolvedValue({ getDocument } as unknown as Awaited<ReturnType<typeof ensurePdfWorker>>);
    const source = new Uint8Array([37, 80, 68, 70]).buffer;
    const container = document.createElement('div');
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const { cleanup } = await renderPdfInContainer(container, source);
      expect(container.querySelectorAll('canvas')).toHaveLength(1);
      expect([...new Uint8Array(source)]).toEqual([37, 80, 68, 70]);
      cleanup();
    }
    expect(destroy).toHaveBeenCalledTimes(2);
  });
});

it('jumps to an unloaded PDF page without rasterizing intermediate pages', async () => {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1; });
  vi.stubGlobal('IntersectionObserver', class {
    observe() {}
    disconnect() {}
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ fillRect: vi.fn() } as unknown as CanvasRenderingContext2D);
  const scrolled: string[] = [];
  const previous = HTMLElement.prototype.scrollIntoView;
  HTMLElement.prototype.scrollIntoView = function () { scrolled.push(this.dataset.pdfPage ?? ''); };
  const getPage = vi.fn(async (_page: number) => ({
    getViewport: () => ({ width: 30, height: 30 }),
    render: () => ({ promise: Promise.resolve() }),
  }));
  vi.mocked(ensurePdfWorker).mockResolvedValue({
    getDocument: () => ({ destroy: async () => {}, promise: Promise.resolve({ numPages: 30, getPage }) }),
  } as unknown as Awaited<ReturnType<typeof ensurePdfWorker>>);
  const container = document.createElement('div');
  try {
    const { goToPage, cleanup } = await renderPdfInContainer(container, new ArrayBuffer(4));
    try {
      await goToPage(24);
      await goToPage(24);
      expect(getPage.mock.calls.map(([page]) => page)).toEqual([1, 2, 3, 4, 5, 24]);
      expect(container.querySelectorAll('[data-pdf-page="24"]')).toHaveLength(1);
      expect(scrolled).toEqual(['24', '24']);
    } finally { cleanup(); }
  } finally { HTMLElement.prototype.scrollIntoView = previous; }
});
