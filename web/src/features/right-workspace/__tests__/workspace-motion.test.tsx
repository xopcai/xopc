// @vitest-environment jsdom
import { act, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useWorkspaceMotion } from '../use-workspace-motion';

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let reduced = false;
let finish: Array<() => void>;
const cancel = vi.fn();
const animate = vi.fn(() => ({ finished: new Promise<void>(resolve => finish.push(resolve)), cancel, playState: 'running' }));
function Harness({ open, selection = 'a' }: { open: boolean; selection?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const present = useWorkspaceMotion(ref, open);
  return <div ref={ref} hidden={!present}><section role="tabpanel">{selection}</section>Retained controller</div>;
}
beforeEach(() => {
  finish = []; reduced = false; vi.clearAllMocks();
  vi.stubGlobal('matchMedia', () => ({ matches: reduced, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: animate });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); delete (HTMLElement.prototype as Partial<HTMLElement>).animate; vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('retains the same controller until exit finishes', async () => {
  await act(async () => root.render(<Harness open />));
  const panel = container.firstElementChild;
  await act(async () => root.render(<Harness open={false} />));
  expect(panel?.hasAttribute('hidden')).toBe(false);
  await act(async () => finish.at(-1)?.());
  expect(panel?.hasAttribute('hidden')).toBe(true);
  expect(container.firstElementChild).toBe(panel);
});
it('cancels exit when reopened before completion', async () => {
  vi.spyOn(window, 'getComputedStyle').mockReturnValue({ opacity: '0.4', transform: 'matrix(1, 0, 0, 1, 6, 0)' } as CSSStyleDeclaration);
  await act(async () => root.render(<Harness open />));
  await act(async () => root.render(<Harness open={false} />));
  const staleFinish = finish.at(-1);
  await act(async () => root.render(<Harness open />));
  await act(async () => staleFinish?.());
  expect(cancel).toHaveBeenCalled();
  expect((animate.mock.calls.at(-1) as unknown as [Keyframe[]])[0][0]).toEqual({ opacity: '0.4', transform: 'matrix(1, 0, 0, 1, 6, 0)' });
  expect(container.firstElementChild?.hasAttribute('hidden')).toBe(false);
});
it('keeps the panel still and does not restart its animation when switching files', async () => {
  await act(async () => root.render(<Harness open />));
  const panel = container.firstElementChild;
  const openingCalls = animate.mock.calls.length;
  expect(openingCalls).toBe(1);
  await act(async () => root.render(<Harness open selection="b" />));
  await act(async () => root.render(<Harness open selection="c" />));
  expect(container.firstElementChild).toBe(panel);
  expect(container.querySelector('[role="tabpanel"]')?.textContent).toBe('c');
  expect(animate).toHaveBeenCalledTimes(openingCalls);
  expect(cancel).not.toHaveBeenCalled();
  for (const [frames] of animate.mock.calls as unknown as [Keyframe[]][]) {
    expect(Object.keys(frames[0]).sort()).toEqual(['opacity', 'transform']);
  }
});
it('skips motion with reduced motion and still closes', async () => {
  reduced = true;
  await act(async () => root.render(<Harness open />));
  await act(async () => root.render(<Harness open={false} />));
  expect(animate).not.toHaveBeenCalled();
  expect(container.firstElementChild?.hasAttribute('hidden')).toBe(true);
});
