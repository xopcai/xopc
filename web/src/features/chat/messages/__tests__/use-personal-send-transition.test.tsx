// @vitest-environment jsdom
import { act, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Message } from '@/features/chat/messages/messages.types';
import { usePersonalSendTransition } from '../use-personal-send-transition';

describe('Personal AI send transition', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let dispatch: ReturnType<typeof usePersonalSendTransition>;
  let finishAnimation: () => void;
  let reducedMotion = false;
  const source = { left: 32, top: 650, right: 220, bottom: 690 } as DOMRect;
  const draft = { text: 'Hello', attachments: [], contextRefs: [] };
  const message: Message = {
    role: 'user', content: [{ type: 'text', text: 'Hello' }],
    timestamp: 1, clientSubmissionId: 'send-1', deliveryStatus: 'sending',
  };

  function Harness({ messages, conversationId = 'personal' }: { messages: Message[]; conversationId?: string | null }) {
    const viewportRef = useRef<HTMLDivElement>(null);
    dispatch = usePersonalSendTransition({ enabled: true, conversationId, messages, viewportRef });
    return <div data-viewport ref={viewportRef}>{messages.map((item) => (
      <div key={item.clientSubmissionId} data-chat-message-row data-client-submission-id={item.clientSubmissionId}>
        <div className="chat-user-message">Hello</div>
      </div>
    ))}</div>;
  }

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    reducedMotion = false;
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: reducedMotion })));
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return (this.classList.contains('chat-user-message')
        ? { left: 300, top: 300, right: 420, bottom: 350, width: 120, height: 50 }
        : { left: 0, top: 0, right: 600, bottom: 600, width: 600, height: 600 }) as DOMRect;
    });
    vi.stubGlobal('innerWidth', 800);
    vi.stubGlobal('innerHeight', 800);
    Object.defineProperty(HTMLElement.prototype, 'animate', {
      configurable: true,
      value: vi.fn(() => {
        const finished = new Promise<void>((resolve) => { finishAnimation = resolve; });
        return { finished, cancel: vi.fn() } as unknown as Animation;
      }),
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    document.querySelectorAll('[data-personal-send-ghost]').forEach((ghost) => ghost.remove());
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete (HTMLElement.prototype as unknown as { animate?: typeof Element.prototype.animate }).animate;
  });

  it('keeps the real optimistic bubble visible throughout the send animation', async () => {
    await act(async () => root.render(<Harness messages={[]} />));
    act(() => dispatch({ clientSubmissionId: 'send-1' }, source, draft));
    await act(async () => root.render(<Harness messages={[message]} />));

    const bubble = container.querySelector<HTMLElement>('.chat-user-message');
    expect(bubble?.style.visibility).toBe('');
    expect(document.querySelector('[data-personal-send-ghost]')).toBeNull();
    expect(HTMLElement.prototype.animate).toHaveBeenCalledTimes(1);
    expect(HTMLElement.prototype.animate).toHaveBeenCalledWith([
      { transform: 'translate3d(-268px, 350px, 0)' },
      { transform: 'translate3d(0, 0, 0)' },
    ], { duration: 360, easing: 'cubic-bezier(0.25, 0.1, 0.25, 1)' });
    await act(async () => finishAnimation());
    expect(bubble?.style.visibility).toBe('');
    expect(document.querySelector('[data-personal-send-ghost]')).toBeNull();
  });

  it('shows the real bubble immediately when reduced motion is requested', async () => {
    reducedMotion = true;
    await act(async () => root.render(<Harness messages={[]} />));
    act(() => dispatch({ clientSubmissionId: 'send-1' }, source, draft));
    await act(async () => root.render(<Harness messages={[message]} />));

    expect(document.querySelector('[data-personal-send-ghost]')).toBeNull();
    expect(container.querySelector<HTMLElement>('.chat-user-message')?.style.visibility).toBe('');
    expect(HTMLElement.prototype.animate).not.toHaveBeenCalled();
  });

  it('keeps the real bubble visible through automatic list scrolling', async () => {
    await act(async () => root.render(<Harness messages={[]} />));
    act(() => dispatch({ clientSubmissionId: 'send-1' }, source, draft));
    await act(async () => root.render(<Harness messages={[message]} />));

    act(() => container.querySelector('[data-viewport]')?.dispatchEvent(new Event('scroll')));
    expect(container.querySelector<HTMLElement>('.chat-user-message')?.style.visibility).toBe('');
    expect(document.querySelector('[data-personal-send-ghost]')).toBeNull();
    expect(HTMLElement.prototype.animate).toHaveBeenCalledTimes(1);
    await act(async () => finishAnimation());
    expect(container.querySelector<HTMLElement>('.chat-user-message')?.style.visibility).toBe('');
    expect(document.querySelector('[data-personal-send-ghost]')).toBeNull();
  });

  it('does not mistake the animated bubble position for a scroll interruption', async () => {
    await act(async () => root.render(<Harness messages={[]} />));
    act(() => dispatch({ clientSubmissionId: 'send-1' }, source, draft));
    await act(async () => root.render(<Harness messages={[message]} />));
    const bubble = container.querySelector<HTMLElement>('.chat-user-message')!;
    bubble.getBoundingClientRect = () => ({ left: 300, top: 200, right: 420, bottom: 250 }) as DOMRect;
    act(() => container.querySelector('[data-viewport]')?.dispatchEvent(new Event('scroll')));
    const animation = vi.mocked(HTMLElement.prototype.animate).mock.results[0].value;
    expect(animation.cancel).not.toHaveBeenCalled();
    expect(bubble.style.visibility).toBe('');
    expect(document.querySelector('[data-personal-send-ghost]')).toBeNull();
  });

  it('keeps content visible even when the browser never resolves the animation', async () => {
    vi.useFakeTimers();
    try {
      await act(async () => root.render(<Harness messages={[]} />));
      act(() => dispatch({ clientSubmissionId: 'send-1' }, source, draft));
      await act(async () => root.render(<Harness messages={[message]} />));
      act(() => vi.advanceTimersByTime(510));
      expect(vi.mocked(HTMLElement.prototype.animate).mock.results[0].value.cancel).toHaveBeenCalled();
      expect(container.querySelector<HTMLElement>('.chat-user-message')?.style.visibility).toBe('');
      expect(document.querySelector('[data-personal-send-ghost]')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('animates multiline messages instead of silently skipping them', async () => {
    await act(async () => root.render(<Harness messages={[]} />));
    act(() => dispatch({ clientSubmissionId: 'send-1' }, source, { ...draft, text: 'First line\nSecond line' }));
    await act(async () => root.render(<Harness messages={[message]} />));

    expect(document.querySelector('[data-personal-send-ghost]')).toBeNull();
    expect(HTMLElement.prototype.animate).toHaveBeenCalledTimes(1);
  });

  it('ends the flight when the user starts scrolling manually', async () => {
    await act(async () => root.render(<Harness messages={[]} />));
    act(() => dispatch({ clientSubmissionId: 'send-1' }, source, draft));
    await act(async () => root.render(<Harness messages={[message]} />));

    act(() => container.querySelector('[data-viewport]')?.dispatchEvent(new Event('wheel')));
    expect(vi.mocked(HTMLElement.prototype.animate).mock.results[0].value.cancel).toHaveBeenCalled();
    expect(container.querySelector<HTMLElement>('.chat-user-message')?.style.visibility).toBe('');
    expect(document.querySelector('[data-personal-send-ghost]')).toBeNull();
  });

  it('preserves the first send when dispatch creates a conversation', async () => {
    await act(async () => root.render(<Harness messages={[]} conversationId={null} />));
    act(() => dispatch({ clientSubmissionId: 'send-1' }, source, draft));
    await act(async () => root.render(<Harness messages={[message]} conversationId="created" />));

    expect(HTMLElement.prototype.animate).toHaveBeenCalledTimes(1);
    const animation = vi.mocked(HTMLElement.prototype.animate).mock.results[0].value;
    expect(animation.cancel).not.toHaveBeenCalled();

    await act(async () => root.render(<Harness messages={[]} conversationId="other" />));
    expect(animation.cancel).toHaveBeenCalled();
  });
});
