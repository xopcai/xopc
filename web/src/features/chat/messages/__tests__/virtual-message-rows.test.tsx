// @vitest-environment jsdom
import { act, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { VirtualMessageRows } from '../virtual-message-rows';

const state = vi.hoisted((): { viewport: unknown } => ({ viewport: undefined }));
vi.mock('react-virtuoso', () => ({ Virtuoso: (props: { increaseViewportBy: unknown }) => {
  state.viewport = props.increaseViewportBy;
  return <div data-chat-message-row><button type="button">Preview</button><p>Selectable history</p></div>;
} }));

describe('virtual history interaction window', () => {
  let root: ReturnType<typeof createRoot>;
  let container: HTMLDivElement;
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement('div'); document.body.append(container);
    root = createRoot(container);
    const scrollRef = createRef<HTMLDivElement>(); scrollRef.current = container;
    act(() => root.render(<VirtualMessageRows rows={[{ key: 'row', index: 0, aliases: [] }]}
      scrollRef={scrollRef} footer={null} renderRow={() => null} />));
  });
  afterEach(() => { act(() => root.unmount()); window.getSelection()?.removeAllRanges(); container.remove(); });

  it('keeps the window bounded when message controls gain or regain focus', () => {
    const button = container.querySelector('button')!;
    act(() => button.focus());
    expect(state.viewport).toEqual({ top: 800, bottom: 800 });
    act(() => { button.blur(); button.focus(); });
    expect(state.viewport).toEqual({ top: 800, bottom: 800 });
  });

  it('retains the traversed selection window without measuring the whole history', () => {
    const range = document.createRange(); range.selectNodeContents(container.querySelector('p')!);
    act(() => { window.getSelection()?.addRange(range); document.dispatchEvent(new Event('selectionchange')); });
    expect(state.viewport).toEqual({ top: 800, bottom: 800 });
    act(() => { container.scrollTop = 1200; container.dispatchEvent(new Event('scroll')); });
    expect(state.viewport).toEqual({ top: 2000, bottom: 800 });
    act(() => { container.scrollTop = 400; container.dispatchEvent(new Event('scroll')); });
    expect(state.viewport).toEqual({ top: 1200, bottom: 1600 });
    act(() => { window.getSelection()?.removeAllRanges(); document.dispatchEvent(new Event('selectionchange')); });
    expect(state.viewport).toEqual({ top: 800, bottom: 800 });
  });
});
