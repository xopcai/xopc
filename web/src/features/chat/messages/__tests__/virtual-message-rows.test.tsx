// @vitest-environment jsdom
import { act, createRef, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { VirtualMessageRows, type MessageRowDescriptor } from '../virtual-message-rows';

const state = vi.hoisted((): { viewport: unknown } => ({ viewport: undefined }));
vi.mock('react-virtuoso', () => ({ Virtuoso: (props: {
  increaseViewportBy: unknown;
  data: MessageRowDescriptor[];
  itemContent: (index: number, row: MessageRowDescriptor) => ReactNode;
}) => {
  state.viewport = props.increaseViewportBy;
  return <>{props.data.map((row, index) => <div key={row.key}>{props.itemContent(index, row)}</div>)}</>;
} }));

describe('virtual history interaction window', () => {
  let root: ReturnType<typeof createRoot>;
  let container: HTMLDivElement;
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement('div'); document.body.append(container);
    root = createRoot(container);
    const scrollRef = createRef<HTMLDivElement>(); scrollRef.current = container;
    act(() => root.render(<VirtualMessageRows rows={[
      { key: 'row', index: 0, aliases: [] },
      { key: 'media', index: 1, aliases: [], compactTop: true },
      { key: 'next', index: 2, aliases: [] },
    ]} scrollRef={scrollRef} footer={null} renderRow={row => row.index === 0
      ? <div data-chat-message-row><button type="button">Preview</button><p>Selectable history</p></div>
      : <div data-row-key={row.key} />} />));
  });
  afterEach(() => { act(() => root.unmount()); window.getSelection()?.removeAllRanges(); container.remove(); });

  it('measures a smaller gap for cards grouped with the preceding reply', () => {
    expect(container.querySelector('[data-row-key="media"]')?.parentElement?.className).toBe('pt-3');
    expect(container.querySelector('[data-row-key="next"]')?.parentElement?.className).toBe('pt-8');
  });

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
