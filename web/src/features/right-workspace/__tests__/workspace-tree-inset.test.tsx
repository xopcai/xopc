// @vitest-environment jsdom
import { act, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useWorkspaceTreeInset } from '../use-workspace-tree-inset';

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let resize: () => void;
let height = 56;
const disconnect = vi.fn();
function Harness({ active = 'browser', open = true }: { active?: string; open?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const inset = useWorkspaceTreeInset(ref, open, active);
  return <div ref={ref}><div id="workspace-content"><header data-workspace-toolbar hidden /><header data-workspace-toolbar /><aside style={{ top: inset }} /></div></div>;
}
beforeEach(() => {
  height = 56;
  vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { resize = callback; } observe() {} disconnect = disconnect; });
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function (this: HTMLElement) { return (this.hidden ? [] : [{}]) as unknown as DOMRectList; });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) { return { top: 100, bottom: this.tagName === 'HEADER' ? 100 + height : 500 } as DOMRect; });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('keeps the overlay below the visible toolbar and follows wrapped header height', async () => {
  await act(async () => root.render(<Harness />));
  expect(container.querySelector('aside')?.style.top).toBe('56px');
  height = 104;
  await act(async () => resize());
  expect(container.querySelector('aside')?.style.top).toBe('104px');
  await act(async () => root.render(<Harness open={false} />));
  expect(container.querySelector('aside')?.style.top).toBe('0px');
  expect(disconnect).toHaveBeenCalled();
});
