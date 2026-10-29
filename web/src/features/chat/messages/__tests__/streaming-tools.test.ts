import { describe, expect, it } from 'vitest';

import {
  appendReviewDelta,
  appendToolStart,
  completeTool,
  finishReview,
  finalizeRunningTools,
  startReview,
  updateToolDetails,
} from '@/features/chat/messages/streaming';
import type { MessageContent } from '@/features/chat/messages/messages.types';

describe('streaming tool updates', () => {
  it('keeps one tool item when a hydrated start and completed event are replayed', () => {
    const content: MessageContent[] = [];
    appendToolStart(content, 'read_file', { path: 'first.ts' }, 'call-1', 1000);
    appendToolStart(content, 'read_file', { path: 'first.ts' }, 'call-1', 1000);
    completeTool(content, 'read_file', false, 'result', 'call-1', 1500);
    appendToolStart(content, 'read_file', {}, 'call-1', 1000);
    completeTool(content, 'read_file', false, 'result', 'call-1', 1500);
    expect(content).toHaveLength(1);
    expect(content[0]).toMatchObject({ status: 'done', result: 'result', activity: { status: 'completed' } });
  });

  it.each([true, false])('settles both tool states when successful=%s', successful => {
    const content: MessageContent[] = [];
    appendToolStart(content, 'read_file', {}, 'call-1', 1000);
    finalizeRunningTools(content, successful);
    expect(content[0]).toMatchObject({ status: successful ? 'done' : 'error',
      activity: { status: successful ? 'completed' : 'failed' } });
  });
  it('completes a running tool by toolCallId before falling back to tool name', () => {
    const content: MessageContent[] = [];

    appendToolStart(content, 'read_file', { path: 'first.ts' }, 'call-1', 1_000);
    appendToolStart(content, 'read_file', { path: 'second.ts' }, 'call-2', 1_100);

    completeTool(content, 'read_file', false, 'first result', 'call-1', 1_500);

    expect(content).toMatchObject([
      { type: 'tool_use', toolCallId: 'call-1', status: 'done', result: 'first result' },
      { type: 'tool_use', toolCallId: 'call-2', status: 'running' },
    ]);
  });

  it('accumulates live text output on a running tool', () => {
    const content: MessageContent[] = [];
    appendToolStart(content, 'review.model_judge', {}, 'review-1', 1_000);

    updateToolDetails(content, 'review.model_judge', 'review-1', { textDelta: '{\"findings\":' });
    updateToolDetails(content, 'review.model_judge', 'review-1', { textDelta: ' []}' });

    expect(content[0]).toMatchObject({
      type: 'tool_use',
      details: { text: '{\"findings\": []}' },
    });
  });

  it('keeps an isolated review draft separate from tool executions', () => {
    const content: MessageContent[] = [];
    startReview(content, { reviewId: 'review-1', target: 'uncommitted changes', stage: 'preparing' });
    startReview(content, { reviewId: 'review-1', target: 'uncommitted changes', stage: 'reviewing' });
    appendReviewDelta(content, 'review-1', 'Checking auth…');
    appendReviewDelta(content, 'review-1', '\nNo finding yet.');
    finishReview(content, 'review-1', 'complete');

    expect(content).toEqual([expect.objectContaining({
      type: 'review',
      reviewId: 'review-1',
      status: 'complete',
      analysisMarkdown: 'Checking auth…\nNo finding yet.',
    })]);
  });
});
