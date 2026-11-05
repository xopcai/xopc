// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it } from 'vitest';

import { LiveTranscriptView } from '../live-transcript-view';

let root: ReturnType<typeof createRoot>; let container: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });
const render = (text: string) => act(() => root.render(<LiveTranscriptView text={text} placeholder="Waiting" zh />));

it('keeps selected text stable as new speech arrives and resumes only on request', () => {
  render('First sentence');
  const viewport = container.querySelector<HTMLElement>('[aria-label="实时文字"]')!;
  act(() => viewport.dispatchEvent(new Event('pointerdown', { bubbles: true })));
  render('First sentence. A later sentence.');
  expect(viewport.textContent).toBe('First sentence');
  expect(container.textContent).toContain('有新文字');
  act(() => container.querySelector('button')!.click());
  expect(viewport.textContent).toBe('First sentence. A later sentence.');
});

it('follows the tail until the reader scrolls back, then preserves the scroll offset', () => {
  render('First');
  const viewport = container.querySelector<HTMLElement>('[aria-label="实时文字"]')!;
  Object.defineProperties(viewport, { scrollHeight: { value: 800, configurable: true }, clientHeight: { value: 128 } });
  render('First. Second.'); expect(viewport.scrollTop).toBe(800);
  act(() => { viewport.scrollTop = 150; viewport.dispatchEvent(new Event('scroll')); });
  render('First. Second. Third.');
  expect(viewport.scrollTop).toBe(150); expect(viewport.textContent).toBe('First. Second.');
});
