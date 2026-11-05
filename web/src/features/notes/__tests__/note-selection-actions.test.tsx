// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import type { EditorTextSelection } from '@/components/editor-text-selection';
import { NoteSelectionActions } from '../note-selection-actions';

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('@/lib/fetch', () => ({ fetchJson: mocks.fetch }));
let root: ReturnType<typeof createRoot>; let container: HTMLDivElement;
const insert = vi.fn(); const dismiss = vi.fn(); const restore = vi.fn(); const ask = vi.fn();
const selection = (): EditorTextSelection => ({ text: 'Only the selected passage', rect: { left: 100, right: 300, top: 100, bottom: 130 }, insertAfter: insert, restore });
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); vi.resetAllMocks();
  mocks.fetch.mockResolvedValue({ patch: { operations: [{ type: 'replaceRange', markdown: '- [ ] A candidate action' }] } });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });
const render = (value = selection()) => act(() => root.render(<NoteSelectionActions noteId="note" selection={value} zh onDismiss={dismiss} onAsk={ask} />));
const button = (text: string) => [...document.querySelectorAll('button')].find(button => button.textContent === text)!;

it('previews only the selection, without changing the note until insertion is confirmed', async () => {
  render(); await act(async () => button('提取待办').click());
  expect(JSON.parse(mocks.fetch.mock.calls[0][1].body)).toEqual({ instruction: 'todo', markdown: 'Only the selected passage' });
  expect(document.body.textContent).toContain('A candidate action'); expect(insert).not.toHaveBeenCalled();
  insert.mockReturnValue(true);
  await act(async () => button('插入选段后').click());
  expect(insert).toHaveBeenCalledWith('- [ ] A candidate action'); expect(dismiss).toHaveBeenCalled();
});

it('keeps the preview when its source document has changed instead of inserting at a stale position', async () => {
  render(); await act(async () => button('摘要预览').click());
  insert.mockReturnValue(false); await act(async () => button('插入选段后').click());
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('正文已变化'); expect(dismiss).not.toHaveBeenCalled();
});

it('aborts an old selection request and ignores its late response', async () => {
  let resolve!: (value: unknown) => void;
  mocks.fetch.mockReturnValueOnce(new Promise(done => { resolve = done; }));
  render(); await act(async () => button('摘要预览').click());
  const signal = mocks.fetch.mock.calls[0][1].signal as AbortSignal;
  render({ ...selection(), text: 'Another passage' }); expect(signal.aborted).toBe(true);
  await act(async () => resolve({ patch: { operations: [{ type: 'replaceRange', markdown: 'Late old result' }] } }));
  expect(document.body.textContent).not.toContain('Late old result');
});

it('passes an immutable quote to the existing question flow and restores selection on Escape', () => {
  render(); act(() => button('引用提问').click()); expect(ask).toHaveBeenCalledWith('Only the selected passage');
  act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(dismiss).toHaveBeenCalled(); expect(restore).toHaveBeenCalled();
});
