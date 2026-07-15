import { describe, expect, it } from 'vitest';

import { appendToolStart, completeTool } from '@/features/chat/messages/streaming';
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
});
