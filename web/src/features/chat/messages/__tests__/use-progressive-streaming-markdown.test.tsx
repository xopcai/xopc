// @vitest-environment jsdom

import { act, StrictMode, useLayoutEffect } from 'react';
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
    act(() => vi.advanceTimersByTime(64));
    expect(container.textContent).toBe('abcdefgh');
    act(() => vi.advanceTimersByTime(64));
    act(() => vi.advanceTimersByTime(64));
    expect(container.textContent).toBe('abcdefghijkl');
  });
  it('does not wait for a timer before revealing the first Personal delta', () => {
    act(() => root.render(<Harness content="" streaming immediateFirstCommit />));
    act(() => root.render(<Harness content="先看结论。" streaming immediateFirstCommit />));
    expect(container.textContent).toBe('先看结论。');
    act(() => root.render(<Harness content={'先看结论。\n\n这是后续说明。'} streaming immediateFirstCommit />));
    expect(container.textContent).toBe('先看结论。');
    act(() => vi.advanceTimersByTime(64));
    expect(container.textContent).toMatch(/^先看结论。\n/);
    for (let frame = 0; frame < 3; frame++) act(() => vi.advanceTimersByTime(64));
    expect(container.textContent).toContain('这是');
    act(() => root.render(<Harness content={'先看结论。\n\n这是后续说明。'} streaming={false} immediateFirstCommit />));
    act(() => vi.advanceTimersByTime(320));
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
    act(() => vi.advanceTimersByTime(64));
    expect(container.textContent).toBe('abcdefgh');
    act(() => vi.advanceTimersByTime(64));
    act(() => vi.advanceTimersByTime(64));
    expect(container.textContent).toBe('abcdefghijkl');
  });

  it('commits pending text atomically when the realtime stream ends', () => {
    act(() => root.render(<Harness content="abcdef" streaming />));
    act(() => root.render(<Harness content="abcdefghijklmnopqr" streaming />));
    act(() => root.render(<Harness content="abcdefghijklmnopqr" streaming={false} />));
    expect(container.textContent).toBe('abcdefghijklmnopqr');
    expect(vi.getTimerCount()).toBe(0);
    act(() => vi.runAllTimers());
    expect(container.textContent).toBe('abcdefghijklmnopqr');
  });

  it('drains a burst across frames without a timed full flush', () => {
    act(() => root.render(<Harness content="Start." streaming />));
    const content = 'Start.' + '内容持续平滑显示。'.repeat(200);
    act(() => root.render(<Harness content={content} streaming />));
    act(() => vi.advanceTimersByTime(300));
    const partial = container.textContent ?? '';
    expect(partial.length).toBeGreaterThan(6);
    expect(partial.length).toBeLessThan(content.length);
    expect(content.startsWith(partial)).toBe(true);
    act(() => vi.advanceTimersByTime(5000));
    expect(container.textContent).toBe(content);
  });

  it('discards a pending animation frame when final text arrives', () => {
    const onComplete = vi.fn();
    act(() => root.render(<Harness content="Start." streaming onComplete={onComplete} />));
    act(() => root.render(<Harness content={'Start.' + 'x'.repeat(1000)} streaming onComplete={onComplete} />));
    act(() => vi.advanceTimersByTime(50));
    act(() => root.render(<Harness content="Final text." streaming={false} onComplete={onComplete} />));
    expect(container.textContent).toBe('Final text.');
    act(() => vi.runAllTimers());
    expect(container.textContent).toBe('Final text.');
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('resets pacing when pending content is replaced even if the visible prefix is unchanged', () => {
    act(() => root.render(<Harness content="Start." streaming />));
    act(() => root.render(<Harness content={'Start.' + 'x'.repeat(1000)} streaming />));
    act(() => root.render(<Harness content="Start. revised" streaming />));
    expect(container.textContent).toBe('Start. revised');
    act(() => vi.runAllTimers());
    expect(container.textContent).toBe('Start. revised');
  });

  it('exposes the complete terminal burst to layout effects and notifies once', () => {
    const commits: Array<{ streaming: boolean; text: string }> = [];
    const onComplete = vi.fn();
    function Probe({ content, streaming }: { content: string; streaming: boolean }) {
      const text = useProgressiveStreamingMarkdown(content, streaming, 'terminal-commit', false, onComplete);
      useLayoutEffect(() => { commits.push({ streaming, text }); }, [streaming, text]);
      return <div>{text}</div>;
    }
    act(() => root.render(<Probe content="Short" streaming />));
    act(() => root.render(<Probe content="Short answer with a final burst." streaming />));
    expect(container.textContent).toBe('Short');
    act(() => root.render(<Probe content="Short answer with a final burst." streaming={false} />));
    expect(commits.at(-1)).toEqual({ streaming: false, text: 'Short answer with a final burst.' });
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    act(() => vi.runAllTimers());
    expect(container.textContent).toBe('Short answer with a final burst.');
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('commits the first conversational delta without an empty intermediate layout', () => {
    const commits: string[] = [];
    function Probe({ content }: { content: string }) {
      const text = useProgressiveStreamingMarkdown(content, true, 'first-commit', false, undefined, true);
      useLayoutEffect(() => { commits.push(text); });
      return <div>{text}</div>;
    }
    act(() => root.render(<Probe content="" />));
    commits.length = 0;
    act(() => root.render(<Probe content="先看结论。" />));
    expect(commits.length).toBeGreaterThan(0);
    expect(commits.every(text => text === '先看结论。')).toBe(true);
  });

  it('shows the terminal snapshot immediately when reduced motion is requested', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
    try {
      act(() => root.render(<Harness content="Start." streaming />));
      act(() => root.render(<Harness content="Start. Final answer." streaming={false} />));
      expect(container.textContent).toBe('Start. Final answer.');
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
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
