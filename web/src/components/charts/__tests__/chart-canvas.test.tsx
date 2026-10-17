// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChartSpec } from '@xopcai/chart-spec';

import { ChartCanvas } from '../chart-canvas';

const runtime = vi.hoisted(() => ({ load: vi.fn(), init: vi.fn(), setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn() }));
vi.mock('../chart-runtime-loader', () => ({ loadChartRuntime: runtime.load }));
const spec: ChartSpec = {
  version: 1, type: 'bar', title: 'Title', summary: 'Summary', dataKind: 'example',
  xAxis: { label: 'Category', values: ['A'] }, yAxis: { label: 'Amount', unit: 'CNY' },
  series: [{ name: 'Value', values: [1] }],
};

describe('chart canvas resource lifecycle', () => {
  let root: ReturnType<typeof createRoot>;
  let container: HTMLDivElement;
  let width: number;
  let resized: () => void;
  const disconnect = vi.fn();
  const error = vi.fn();
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.resetAllMocks();
    runtime.load.mockResolvedValue({ init: runtime.init });
    runtime.init.mockReturnValue(runtime);
    width = 800;
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => width);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(360);
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { resized = callback; }
      observe() {}
      disconnect = disconnect;
    });
    container = document.createElement('div'); document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  const render = async () => { await act(async () => root.render(<ChartCanvas spec={spec} onError={error} />)); };

  it('waits for measurable dimensions, resizes an existing instance and disposes on removal', async () => {
    width = 0;
    await render();
    expect(runtime.init).not.toHaveBeenCalled();
    width = 800;
    await act(async () => { resized(); await new Promise(requestAnimationFrame); });
    expect(runtime.init).toHaveBeenCalledTimes(1);
    width = 640;
    await act(async () => { resized(); resized(); await new Promise(requestAnimationFrame); });
    expect(runtime.resize).toHaveBeenCalledTimes(1);
    await act(async () => { resized(); await new Promise(requestAnimationFrame); });
    expect(runtime.resize).toHaveBeenCalledTimes(1);
    act(() => root.render(null));
    expect(runtime.dispose).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('does not create an instance when an import completes after unmount', async () => {
    let resolve!: (value: { init: typeof runtime.init }) => void;
    runtime.load.mockReturnValue(new Promise(value => { resolve = value; }));
    await render();
    act(() => root.render(null));
    await act(async () => resolve({ init: runtime.init }));
    expect(runtime.init).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it('reports dependency load failures', async () => {
    runtime.load.mockRejectedValue(new Error('offline'));
    await render();
    expect(error).toHaveBeenCalledTimes(1);
    expect(runtime.init).not.toHaveBeenCalled();
  });
});
