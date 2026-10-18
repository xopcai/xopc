// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SharePreviewPage } from '@/pages/share-preview-page';

const runtime = vi.hoisted(() => ({ init: vi.fn(), setOption: vi.fn(), dispose: vi.fn(), resize: vi.fn() }));
vi.mock('../../../components/charts/chart-runtime-loader', () => ({ loadChartRuntime: () => Promise.resolve({ init: runtime.init }) }));
vi.mock('../../file-preview/file-preview', () => ({ FilePreview: () => null }));
vi.mock('../../chat/product-delivery/inline-preview-scheduler', () => ({
  InlinePreviewSchedulerProvider: ({ children }: { children: unknown }) => children,
  useInlinePreviewLease: () => ({ active: true, containerRef: () => {}, activate: () => {} }),
}));

const fence = (type: string) => `\`\`\`chart\n${JSON.stringify({ version: 1, type,
  title: `${type} chart`, summary: 'Public share data', dataKind: 'example',
  xAxis: { label: 'Month', values: ['A', 'B', 'C'] }, yAxis: { label: 'Amount', unit: 'CNY' },
  series: [{ name: 'Value', values: [-2, null, 0] }],
})}\n\`\`\``;

describe('public share chart rendering', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.clearAllMocks(); runtime.init.mockReturnValue(runtime);
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(360);
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  async function render(kind: 'note' | 'session', markdown = `${fence('line')}\n\n${fence('bar')}`) {
    const payload = { kind, title: 'Shared charts', snapshotAt: '2026-10-18T00:00:00Z', expiresAt: '2027-01-01T00:00:00Z', attachments: [],
      ...(kind === 'note' ? { markdown } : { messages: [{ id: 'm1', role: 'assistant', markdown, attachmentIds: [] }], toolActivities: [] }) };
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith('/meta')
      ? { kind, fileName: 'Charts', fileSize: 1, valid: true, expiresAt: payload.expiresAt }
      : { payload }), { headers: { 'content-type': 'application/json' } })));
    await act(async () => root.render(<MemoryRouter initialEntries={['/s/public/preview']}><Routes>
      <Route path="/s/:token/preview" element={<SharePreviewPage />} />
    </Routes></MemoryRouter>));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  }

  it.each(['note', 'session'] as const)('renders line and bar charts from public %s payloads', async kind => {
    await render(kind);
    expect(container.querySelectorAll('[data-chart-block]')).toHaveLength(2);
    expect(runtime.setOption.mock.calls.map(([option]) => option.series[0].type)).toEqual(['line', 'bar']);
    expect(runtime.setOption.mock.calls[0][0].series[0].data).toEqual([-2, null, 0]);
    act(() => root.render(null));
    expect(runtime.dispose).toHaveBeenCalledTimes(2);
  });

  it('keeps the public remote-image policy beside charts', async () => {
    await render('note', `${fence('line')}\n\n![blocked](https://invalid.example/image.png)`);
    expect(container.querySelector('[data-chart-block]')).not.toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('a[href="https://invalid.example/image.png"]')).not.toBeNull();
  });

  it('retains invalid and unfinished source without initializing a chart', async () => {
    await render('session', '```chart\n{"version":2}\n```\n\n```chart\n{"version":1}');
    expect(container.querySelector('[data-chart-error]')).not.toBeNull();
    expect(container.querySelector('[data-chart-pending]')).not.toBeNull();
    expect(runtime.init).not.toHaveBeenCalled();
  });
});
