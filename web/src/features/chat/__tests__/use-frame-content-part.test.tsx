// @vitest-environment jsdom
import { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultSessionMeta } from '../session/chat-session-defaults';
import { useChatSessionStore } from '../session/chat-session-store';
import { useChatContentPart } from '../rendering/use-chat-render-state';
import { knownPartRenderKey } from '../rendering/part-identity';
import { appendTextDelta } from '../messages/streaming';

const store = () => useChatSessionStore.getState();
function seed(id: string) {
  store().initSessionSnapshot(id, {
    ...defaultSessionMeta(), historyStatus: 'ready', messages: [], hasMore: false,
    streamingMsg: { role: 'assistant', content: [{ type: 'text', text: '' }] },
    sending: false, streaming: true, progress: null, taskPlan: null,
  });
}

describe('frame-coalesced chat presentation', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let frames: Map<number, FrameRequestCallback>;
  let renders: number;
  const flush = () => act(() => {
    const callbacks = [...frames.values()];
    frames.clear();
    callbacks.forEach((callback) => callback(0));
  });
  function Harness({ id = 'first' }: { id?: string }) {
    const session = store().sessions[id];
    const raw = session?.streamingMsg?.content[0] ?? session?.messages.at(-1)?.content[0];
    const block = useChatContentPart(id, raw ? knownPartRenderKey(raw) : undefined);
    renders++;
    return <div>{block?.type === 'text' ? block.text : ''}</div>;
  }
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.useFakeTimers();
    frames = new Map();
    let frameId = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.set(++frameId, callback);
      return frameId;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
    useChatSessionStore.setState({ sessions: {} });
    seed('first');
    renders = 0;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    expect(frames.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    container.remove();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
  it('absorbs 100 separate token notifications into one render without losing text', () => {
    act(() => root.render(<Harness />));
    const before = renders;
    const previous = store().sessions.first.streamingMsg;
    for (let i = 0; i < 100; i++) {
      act(() => store().mutateSessionStreaming('first', message => appendTextDelta(message.content, 'x')));
      store().setSessionFlags('first', { streaming: true });
    }
    expect(renders).toBe(before);
    expect(previous?.content[0]).toEqual({ type: 'text', text: '' });
    expect(frames.size).toBe(1);
    flush();
    expect(renders - before).toBe(1);
    expect(container.textContent).toBe('x'.repeat(100));
  });
  it('publishes a terminal reply immediately and cancels a pending paint', () => {
    act(() => root.render(<Harness />));
    act(() => store().mutateSessionStreaming('first', message => appendTextDelta(message.content, 'Final')));
    act(() => store().finalizeStreamingTurn('first', store().sessions.first.streamingMsg!));
    expect(container.textContent).toBe('Final');
    expect(frames.size).toBe(0);
  });
  it('converges when animation frames are throttled', () => {
    act(() => root.render(<Harness />));
    act(() => store().mutateSessionStreaming('first', message => appendTextDelta(message.content, 'Background')));
    act(() => vi.advanceTimersByTime(50));
    expect(container.textContent).toBe('Background');
    expect(frames.size).toBe(0);
  });
  it('switches conversations immediately and cleans up under StrictMode', () => {
    seed('second');
    act(() => root.render(<StrictMode><Harness /></StrictMode>));
    act(() => store().mutateSessionStreaming('first', message => appendTextDelta(message.content, 'Old')));
    act(() => root.render(<StrictMode><Harness id="second" /></StrictMode>));
    expect(container.textContent).toBe('');
    expect(frames.size).toBe(0);
    act(() => store().mutateSessionStreaming('second', message => appendTextDelta(message.content, 'New')));
    flush();
    expect(container.textContent).toBe('New');
  });
});
