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

  function Harness({ messages }: { messages: Message[] }) {
    const viewportRef = useRef<HTMLDivElement>(null);
    dispatch = usePersonalSendTransition({ enabled: true, conversationId: 'personal', messages, viewportRef });
    return <div data-viewport ref={viewportRef}>{messages.map((item) => (
      <div key={item.clientSubmissionId} data-client-submission-id={item.clientSubmissionId}>
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

  it('hands off a plain optimistic message and restores its real bubble', async () => {
    await act(async () => root.render(<Harness messages={[]} />));
    act(() => dispatch({ clientSubmissionId: 'send-1' }, source, draft));
    await act(async () => root.render(<Harness messages={[message]} />));

    const bubble = container.querySelector<HTMLElement>('.chat-user-message');
    expect(bubble?.style.visibility).toBe('hidden');
    expect(document.querySelector('[data-personal-send-ghost]')).not.toBeNull();
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
  });

  it('ends the flight immediately if the user scrolls', async () => {
    await act(async () => root.render(<Harness messages={[]} />));
    act(() => dispatch({ clientSubmissionId: 'send-1' }, source, draft));
    await act(async () => root.render(<Harness messages={[message]} />));

    act(() => container.querySelector('[data-viewport]')?.dispatchEvent(new Event('scroll')));
    expect(container.querySelector<HTMLElement>('.chat-user-message')?.style.visibility).toBe('');
    expect(document.querySelector('[data-personal-send-ghost]')).toBeNull();
  });
});
