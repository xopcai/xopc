// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { AutomationSplitLayout } from '../automation-split-layout';

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const render = () => act(() => root.render(
  <AutomationSplitLayout language="zh" busy={false}><aside>Tasks</aside><main>Details</main></AutomationSplitLayout>,
));
const separator = () => container.querySelector<HTMLElement>('[role="separator"]')!;
function pointer(type: string, clientX: number) {
  const event = new MouseEvent(type, { bubbles: true, button: 0, clientX });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  act(() => separator().dispatchEvent(event));
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); });

it('drags both ways, bounds the width, persists it and resets on double click', () => {
  render();
  vi.spyOn(container.querySelector('section')!, 'getBoundingClientRect').mockReturnValue({ width: 900 } as DOMRect);
  vi.spyOn(container.querySelector('aside')!, 'getBoundingClientRect').mockReturnValue({ width: 272 } as DOMRect);
  separator().setPointerCapture = vi.fn();
  separator().releasePointerCapture = vi.fn();
  pointer('pointerdown', 272);
  pointer('pointermove', 400);
  expect(separator().getAttribute('aria-valuenow')).toBe('400');
  expect(document.body.style.cursor).toBe('col-resize');
  pointer('pointermove', 1000);
  expect(separator().getAttribute('aria-valuenow')).toBe('540');
  pointer('pointermove', 0);
  expect(separator().getAttribute('aria-valuenow')).toBe('200');
  pointer('pointerup', 0);
  expect(localStorage.getItem('xopc.automations.listWidth')).toBe('200');
  expect(document.body.style.cursor).toBe('');
  act(() => separator().dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
  expect(separator().getAttribute('aria-valuenow')).toBe('272');
});

it('restores saved width, supports the keyboard and cleans up interrupted drags', () => {
  localStorage.setItem('xopc.automations.listWidth', '320');
  render();
  vi.spyOn(container.querySelector('section')!, 'getBoundingClientRect').mockReturnValue({ width: 1000 } as DOMRect);
  expect(separator().getAttribute('aria-valuenow')).toBe('320');
  act(() => separator().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
  expect(separator().getAttribute('aria-valuenow')).toBe('336');
  act(() => separator().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })));
  expect(separator().getAttribute('aria-valuenow')).toBe('320');
  separator().setPointerCapture = vi.fn();
  pointer('pointerdown', 320);
  act(() => root.render(null));
  expect(document.body.style.userSelect).toBe('');
  expect(document.body.style.cursor).toBe('');
});
