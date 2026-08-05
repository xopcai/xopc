// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ChunkedContent } from '@/features/chat/messages/message-content-renderer';
import type { MessageContent } from '@/features/chat/messages/messages.types';

const emptyLabels = {
  input: '',
  output: '',
  noOutput: '',
};

const stepLabels = {
  thoughts: '',
  thoughtsStreaming: '',
  viewSteps_one: '',
  viewSteps_other: '',
  searchedWeb: '',
  readFile: '',
  stepDetails: '',
  runCommand: '',
  listDirectory: '',
  writeFile: '',
  editFile: '',
  openUrl: '',
  fetchUrl: '',
  unknownTool: '',
  activityCompleted: '',
  activityPartial: '',
  activityFailedCount: '',
  activityAnalysisComplete: '',
  toolFailedImpact: '',
  rawThinking: '',
  toolRunning: '',
  toolError: '',
};

describe('streaming assistant Markdown rendering', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  function render(
    content: MessageContent[],
    streaming: boolean,
    progressiveRender = false,
  ) {
    act(() => {
      root.render(
        <ChunkedContent
          content={content}
          isUser={false}
          isAssistantMessageStreaming={streaming}
          toolLabels={emptyLabels}
          stepLabels={stepLabels}
          clusterLabels={{ done: {} as never, ing: {} as never, join: {} as never }}
          cardLabels={{} as never}
          imagePreviewLabel=""
          onImagePreview={undefined}
          sessionKey={null}
          workflowOptions={{ labels: {} as never }}
          progressiveRender={progressiveRender}
        />,
      );
    });
  }

  it('preserves the tail DOM node when it becomes a completed block', () => {
    vi.useFakeTimers();
    render([{ type: 'text', text: 'Intro.\n\nStill streaming' }], true);
    act(() => vi.advanceTimersByTime(48));
    act(() => vi.advanceTimersByTime(32));
    act(() => vi.advanceTimersByTime(32));
    act(() => vi.advanceTimersByTime(32));
    const previousTail = container.querySelector('.markdown-stream-tail');
    expect(previousTail).not.toBeNull();

    render(
      [{ type: 'text', text: 'Intro.\n\nStill streaming\n\nNext block' }],
      true,
    );
    act(() => vi.advanceTimersByTime(32));
    const completedBlock = Array.from(
      container.querySelectorAll('.markdown-stream-block'),
    ).find((element) => element.textContent?.includes('Still streaming'));

    expect(completedBlock).toBe(previousTail);
  });

  it('keeps the streaming block tree mounted when the response completes', () => {
    vi.useFakeTimers();
    const content: MessageContent[] = [
      { type: 'text', text: 'Intro.\n\nFinal answer' },
    ];
    render(content, true);
    act(() => vi.advanceTimersByTime(48));
    act(() => vi.advanceTimersByTime(32));
    act(() => vi.advanceTimersByTime(32));
    act(() => vi.advanceTimersByTime(32));
    const blockTree = container.querySelector('.markdown-stream-blocks');
    const firstBlock = container.querySelector('.markdown-stream-block');
    expect(blockTree).not.toBeNull();
    expect(firstBlock).not.toBeNull();

    render(content, false);

    expect(container.querySelector('.markdown-stream-blocks')).toBe(blockTree);
    expect(container.querySelector('.markdown-stream-block')).toBe(firstBlock);
  });

  it('coalesces plain-text deltas on the adaptive schedule', () => {
    vi.useFakeTimers();
    render([{ type: 'text', text: 'First' }], true);

    expect(container.textContent?.trim()).toBe('');
    act(() => vi.advanceTimersByTime(48));
    expect(container.textContent?.trim()).toBe('First');

    render([{ type: 'text', text: 'First update' }], true);

    expect(container.textContent?.trim()).toBe('First');
    act(() => vi.advanceTimersByTime(32));
    expect(container.textContent?.trim()).toBe('First updat');
    act(() => vi.advanceTimersByTime(32));
    expect(container.textContent?.trim()).toBe('First update');
  });

  it('animates a completed response that did not render before run_end', () => {
    vi.useFakeTimers();
    render([{ type: 'text', text: 'abcdefghijkl' }], false, true);

    expect(container.textContent?.trim()).toBe('');
    act(() => vi.advanceTimersByTime(48));
    expect(container.textContent?.trim()).toBe('abcdef');
    act(() => vi.advanceTimersByTime(32));
    expect(container.textContent?.trim()).toBe('abcdefghijkl');
  });

  it('renders punctuation-bound strong text through the assistant message pipeline', () => {
    const text = [
      '所以问题的根源，可能不是"怎么放下她"，而是**"你现在的孤独感，有没有别的地方可以安放？"**',
      '',
      '我先问你一个具体的、不复杂的问题，你如实说就好：',
    ].join('\n');

    render([{ type: 'text', text }], false);

    const strong = container.querySelector('.markdown-body strong');
    expect(strong, container.innerHTML).not.toBeNull();
    expect(strong?.textContent).toBe('"你现在的孤独感，有没有别的地方可以安放？"');
    expect(container.textContent).not.toContain('**');
  });

  it('renders punctuation-bound strong text after progressive streaming completes', () => {
    vi.useFakeTimers();
    const text = '前文有"普通引号"，而是**"流式完成后也必须加粗。"**';

    render([{ type: 'text', text }], true);
    for (let step = 0; step < 30; step += 1) {
      act(() => vi.advanceTimersByTime(48));
    }
    render([{ type: 'text', text }], false);

    const strong = container.querySelector('.markdown-body strong');
    expect(strong?.textContent).toBe('"流式完成后也必须加粗。"');
    expect(container.textContent).not.toContain('**');
  });
});
