// @vitest-environment jsdom
import { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatMarkdownRenderer } from '../markdown/chat-markdown-renderer';

const runtime = vi.hoisted(() => ({
  init: vi.fn(), setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn(),
}));
vi.mock('../../../../components/charts/chart-runtime-loader', () => ({ loadChartRuntime: () => Promise.resolve({ init: runtime.init }) }));

const spec = {
  version: 1, type: 'line', title: 'Test chart', summary: 'Income increased', dataKind: 'example',
  xAxis: { label: 'Month', values: ['Jan', 'Feb'] }, yAxis: { label: 'Income', unit: 'CNY' },
  series: [{ name: 'Income', values: [10, 12] }],
};
const source = JSON.stringify(spec);
const fence = (code = source, lang = 'chart') => `\`\`\`${lang}\n${code}\n\`\`\``;

describe('chat chart Markdown', () => {
  let root: ReturnType<typeof createRoot>;
  let container: HTMLDivElement;
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.clearAllMocks();
    runtime.init.mockImplementation(() => runtime);
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(360);
    container = document.createElement('div'); document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); });
  const render = async (content: string, streaming = false) => {
    await act(async () => root.render(<StrictMode><MemoryRouter><ChatMarkdownRenderer content={content} streaming={streaming} /></MemoryRouter></StrictMode>));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  };

  it('renders a chart among prose and preserves the instance as the reply grows', async () => {
    await render(`Before\n\n${fence()}\n\nAfter`, true);
    expect(container.querySelector('[data-chart-block]')).not.toBeNull();
    expect(container.textContent).toContain('Before');
    expect(container.textContent).toContain('After');
    const calls = runtime.init.mock.calls.length;
    expect(calls).toBeGreaterThan(0);
    await render(`Before\n\n${fence()}\n\nAfter growing`, true);
    await render(`Before\n\n${fence()}\n\nAfter growing`, false);
    expect(runtime.init).toHaveBeenCalledTimes(calls);
    act(() => root.render(null));
    expect(runtime.dispose).toHaveBeenCalled();
  });

  it('does not initialize the engine until the actual fence closes', async () => {
    await render(`\`\`\`chart\n${source}`, true);
    expect(runtime.init).not.toHaveBeenCalled();
    expect(container.querySelector('[data-chart-pending]')).not.toBeNull();
    await render(fence(), true);
    expect(runtime.init).toHaveBeenCalled();
  });

  it('preserves an interrupted unclosed fence when loading history', async () => {
    await render(`\`\`\`chart\n${source}`);
    expect(runtime.init).not.toHaveBeenCalled();
    expect(container.querySelector('[data-chart-pending]')).not.toBeNull();
  });

  it('keeps invalid configs as text without passing them to ECharts', async () => {
    await render(fence(JSON.stringify({ ...spec, series: [{ name: 'Income', values: [10] }] })));
    expect(container.querySelector('[data-chart-error]')).not.toBeNull();
    expect(container.textContent).toContain('$.series[0].values');
    expect(runtime.init).not.toHaveBeenCalled();
  });

  it('does not treat ordinary JSON code as a chart', async () => {
    await render(fence(source, 'json'));
    expect(container.querySelector('[data-chart-block]')).toBeNull();
    expect(runtime.init).not.toHaveBeenCalled();
  });

  it('falls back to source when the engine fails and allows retry', async () => {
    runtime.setOption.mockImplementationOnce(() => { throw new Error('render failure'); });
    await render(fence());
    expect(container.querySelector('[data-chart-block] pre')?.textContent).toBe(source);
    const retry = Array.from(container.querySelectorAll('button')).find(button => /Retry|重试/.test(button.textContent ?? ''));
    expect(retry).toBeDefined();
    await act(async () => retry!.click());
    expect(runtime.init.mock.calls.length).toBeGreaterThan(1);
  });
});
