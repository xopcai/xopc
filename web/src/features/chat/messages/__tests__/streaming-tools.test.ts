import { describe, expect, it } from 'vitest';

import {
  appendReviewDelta,
  appendToolStart,
  completeTool,
  finishReview,
  startReview,
  updateToolDetails,
} from '@/features/chat/messages/streaming';
import type { MessageContent } from '@/features/chat/messages/messages.types';

describe('streaming tool updates', () => {
  it('completes a running tool by toolCallId before falling back to tool name', () => {
    const content: MessageContent[] = [];

    appendToolStart(content, 'codebase-memory-mcp.get_code_snippet', { qualified_name: 'first' }, 'call-1');
    appendToolStart(content, 'codebase-memory-mcp.get_code_snippet', { qualified_name: 'second' }, 'call-2');

    completeTool(content, 'codebase-memory-mcp.get_code_snippet', false, 'first result', 'call-1');

    expect(content).toMatchObject([
      { type: 'tool_use', toolCallId: 'call-1', status: 'done', result: 'first result' },
      { type: 'tool_use', toolCallId: 'call-2', status: 'running' },
    ]);
  });

  it('accumulates live text output on a running tool', () => {
    const content: MessageContent[] = [];
    appendToolStart(content, 'review.model_judge', {}, 'review-1');

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
