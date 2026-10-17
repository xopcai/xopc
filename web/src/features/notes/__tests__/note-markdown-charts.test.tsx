// @vitest-environment jsdom
import { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NoteMarkdownView } from '../note-markdown-view';

const mocks = vi.hoisted(() => ({ init: vi.fn(), setOption: vi.fn(), dispose: vi.fn(), resize: vi.fn(), acquire: vi.fn(), release: vi.fn() }));
vi.mock('../../../components/charts/chart-runtime-loader', () => ({ loadChartRuntime: () => Promise.resolve({ init: mocks.init }) }));
vi.mock('../../chat/product-delivery/inline-preview-scheduler', () => ({
  InlinePreviewSchedulerProvider: ({ children }: { children: unknown }) => children,
  useInlinePreviewLease: () => ({ active: true, containerRef: () => {}, activate: () => {} }),
}));
vi.mock('../note-media-blob', () => ({ acquireNoteMediaObjectUrl: mocks.acquire, releaseNoteMediaObjectUrl: mocks.release }));

const sample = (type = 'line', value = 12) => ({
  version: 1, type, title: `${type} chart`, summary: 'A chart in a note', dataKind: 'example',
  xAxis: { label: 'Month', values: ['Jan', 'Feb', 'Mar'] }, yAxis: { label: 'Amount', unit: 'CNY' },
  series: [{ name: 'Amount', values: [value, null, -2] }],
});
const fence = (type = 'line', value = 12) => `\`\`\`chart\n${JSON.stringify(sample(type, value))}\n\`\`\``;

describe('note Markdown charts', () => {
  let root: ReturnType<typeof createRoot>;
  let container: HTMLDivElement;
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.clearAllMocks(); mocks.init.mockReturnValue(mocks); mocks.acquire.mockResolvedValue('blob:note-media');
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(360);
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); });
  const render = async (content: string) => {
    await act(async () => root.render(<StrictMode><MemoryRouter><NoteMarkdownView noteId="n1" content={content} /></MemoryRouter></StrictMode>));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  };

  it('renders both chart types among document text and preserves gaps and negatives', async () => {
    await render(`# Note\n\nBefore\n\n${fence()}\n\n${fence('bar')}\n\nAfter`);
    expect(container.querySelectorAll('[data-chart-block]')).toHaveLength(2);
    expect(container.querySelector('h1')?.textContent).toBe('Note');
    expect(container.textContent).toContain('Before'); expect(container.textContent).toContain('After');
    expect(mocks.setOption).toHaveBeenCalledWith(expect.objectContaining({ series: [expect.objectContaining({ data: [12, null, -2] })] }), { notMerge: true });
  });

  it('updates chart data even when the surrounding HTML and placeholder do not change', async () => {
    await render(fence()); await render(fence('line', 42));
    expect(mocks.setOption).toHaveBeenLastCalledWith(expect.objectContaining({ series: [expect.objectContaining({ data: [42, null, -2] })] }), { notMerge: true });
    await render('Chart removed');
    expect(container.querySelector('[data-chart-block]')).toBeNull();
    expect(mocks.dispose).toHaveBeenCalled();
  });

  it('preserves invalid and unclosed chart source without initializing an engine', async () => {
    await render('```chart\n{"version":2}\n```');
    expect(container.querySelector('[data-chart-error]')).not.toBeNull();
    expect(container.textContent).toContain('"version":2');
    await render(`\`\`\`chart\n${JSON.stringify(sample())}`);
    expect(container.querySelector('[data-chart-pending]')).not.toBeNull();
    expect(mocks.init).not.toHaveBeenCalled();
  });

  it('keeps note media hydration and ordinary code blocks working beside charts', async () => {
    await render(`![Photo](xopc-attachment://notes/n1/a1)\n\n${fence()}\n\n\`\`\`json\n{"ordinary":true}\n\`\`\``);
    expect(mocks.acquire).toHaveBeenCalledWith('n1', 'a1');
    expect(container.querySelector('img')?.getAttribute('src')).toBe('blob:note-media');
    expect(container.querySelectorAll('[data-md-code-block]')).toHaveLength(1);
    await render('Replaced');
    expect(mocks.release).toHaveBeenCalledWith('n1', 'a1');
  });

  it('does not let generic code decorators mutate React-owned chart source on rerender', async () => {
    await render(fence());
    const button = Array.from(container.querySelectorAll('[data-chart-block] button')).find(element => /^(Source|源码)$/.test(element.textContent ?? ''))!;
    act(() => (button as HTMLButtonElement).click());
    await render(`Paragraph\n\n${fence()}`);
    await render('No charts');
    expect(container.textContent).toContain('No charts');
  });
});
