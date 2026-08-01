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

  function render(content: MessageContent[], streaming: boolean) {
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
});
