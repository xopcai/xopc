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
  immediateFirstCommit = false,
}: {
  content: string;
  streaming: boolean;
  animateInitialContent?: boolean;
  onComplete?: () => void;
  immediateFirstCommit?: boolean;
}) {
  const visible = useProgressiveStreamingMarkdown(
    content,
    streaming,
    'test-stream',
    animateInitialContent,
    onComplete,
    immediateFirstCommit,
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

  it('renders the initial stream snapshot immediately and schedules later deltas', () => {
    act(() => root.render(<Harness content="abcdef" streaming />));
    expect(container.textContent).toBe('abcdef');

    act(() => root.render(<Harness content="abcdefghijkl" streaming />));
    expect(container.textContent).toBe('abcdef');
    act(() => vi.advanceTimersByTime(48));
    expect(container.textContent).toBe('abcdefghijkl');
  });
  it('does not wait for a timer before revealing the first Personal delta', () => {
    act(() => root.render(<Harness content="" streaming immediateFirstCommit />));
    act(() => root.render(<Harness content="先看结论。" streaming immediateFirstCommit />));
    expect(container.textContent).toBe('先看结论。');
    act(() => root.render(<Harness content="先看结论。\n\n这是后续说明。" streaming immediateFirstCommit />));
    expect(container.textContent).toBe('先看结论。');
    act(() => vi.advanceTimersByTime(48));
    expect(container.textContent).toContain('这是');
    act(() => root.render(<Harness content="先看结论。\n\n这是后续说明。" streaming={false} immediateFirstCommit />));
    expect(container.textContent).toContain('这是后续说明。');
  });

  it('continues scheduling commits when StrictMode replays mount effects', () => {
    act(() => root.render(
      <StrictMode>
        <Harness content="abcdef" streaming />
      </StrictMode>,
    ));
    expect(container.textContent).toBe('abcdef');

    act(() => root.render(
      <StrictMode>
        <Harness content="abcdefghijkl" streaming />
      </StrictMode>,
    ));
    act(() => vi.advanceTimersByTime(48));
    expect(container.textContent).toBe('abcdefghijkl');
  });

  it('flushes pending text when the realtime stream ends', () => {
    act(() => root.render(<Harness content="abcdef" streaming />));
    act(() => root.render(<Harness content="abcdefghijklmnopqr" streaming />));
    act(() => root.render(<Harness content="abcdefghijklmnopqr" streaming={false} />));
    expect(container.textContent).toBe('abcdefghijklmnopqr');
  });

  it('renders non-streamed history immediately', () => {
    act(() => root.render(<Harness content="Historical answer" streaming={false} />));
    expect(container.textContent).toBe('Historical answer');
  });

  it('renders a completed response immediately when it first mounts', () => {
    const onComplete = vi.fn();
    act(() => root.render(
      <Harness
        content="abcdefghijkl"
        streaming={false}
        animateInitialContent
        onComplete={onComplete}
      />,
    ));

    expect(container.textContent).toBe('abcdefghijkl');
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});
