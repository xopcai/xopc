// @vitest-environment jsdom

import { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useProgressiveStreamingMarkdown } from '@/features/chat/messages/use-progressive-streaming-markdown';

function Harness({
  content,
  streaming,
  animateInitialContent = false,
  onComplete,
}: {
  content: string;
  streaming: boolean;
  animateInitialContent?: boolean;
  onComplete?: () => void;
}) {
  const visible = useProgressiveStreamingMarkdown(
    content,
    streaming,
    'test-stream',
    animateInitialContent,
    onComplete,
  );
  return <div>{visible}</div>;
}

describe('useProgressiveStreamingMarkdown', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it('reveals a fast complete response across multiple commits', () => {
    act(() => root.render(<Harness content="abcdefghijkl" streaming />));
    expect(container.textContent).toBe('');

    act(() => vi.advanceTimersByTime(48));
    expect(container.textContent).toBe('abcdef');

    act(() => vi.advanceTimersByTime(32));
    expect(container.textContent).toBe('abcdefghijkl');
  });

  it('continues scheduling commits when StrictMode replays mount effects', () => {
    act(() => root.render(
      <StrictMode>
        <Harness content="abcdefghijkl" streaming />
      </StrictMode>,
    ));
    expect(container.textContent).toBe('');

    act(() => vi.advanceTimersByTime(48));
    expect(container.textContent).toBe('abcdef');

    act(() => vi.advanceTimersByTime(32));
    expect(container.textContent).toBe('abcdefghijkl');
  });

  it('keeps draining pending text after the SSE stream ends', () => {
    act(() => root.render(<Harness content="abcdefghijklmnopqr" streaming />));
    act(() => root.render(<Harness content="abcdefghijklmnopqr" streaming={false} />));
    expect(container.textContent).toBe('');

    act(() => vi.advanceTimersByTime(48));
    expect(container.textContent).toBe('abcdef');

    act(() => vi.advanceTimersByTime(32));
    expect(container.textContent).toBe('abcdefghijkl');

    act(() => vi.advanceTimersByTime(32));
    expect(container.textContent).toBe('abcdefghijklmnopqr');
  });

  it('renders non-streamed history immediately', () => {
    act(() => root.render(<Harness content="Historical answer" streaming={false} />));
    expect(container.textContent).toBe('Historical answer');
  });

  it('progressively reveals a live response that first mounts after the transport ended', () => {
    const onComplete = vi.fn();
    act(() => root.render(
      <Harness
        content="abcdefghijkl"
        streaming={false}
        animateInitialContent
        onComplete={onComplete}
      />,
    ));

    expect(container.textContent).toBe('');
    act(() => vi.advanceTimersByTime(48));
    expect(container.textContent).toBe('abcdef');
    expect(onComplete).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(32));
    expect(container.textContent).toBe('abcdefghijkl');
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});
