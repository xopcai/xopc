import { describe, expect, it } from 'vitest';

import type { MessageContent } from '@/features/chat/messages/messages.types';
import {
  collectTurnActivityBlocks,
  hasAssistantAnswerText,
} from '@/features/chat/messages/turn-activity';

describe('turn activity', () => {
  it('collects thinking and tools across interleaved assistant text', () => {
    const content: MessageContent[] = [
      { type: 'thinking', text: 'inspect', streaming: false },
      { type: 'text', text: 'I will check that.' },
      { type: 'tool_use', id: 'read-1', name: 'read_file', status: 'done' },
      { type: 'text', text: 'Done.' },
      { type: 'tool_use', id: 'workflow-1', name: 'workflow', status: 'running' },
    ];

    expect(collectTurnActivityBlocks(content).map((block) => block.type)).toEqual([
      'thinking',
      'tool_use',
      'tool_use',
    ]);
  });

  it('detects answer text before or after activity blocks', () => {
    expect(
      hasAssistantAnswerText([
        { type: 'text', text: 'Starting now.' },
        { type: 'tool_use', id: 'tool-1', name: 'search', status: 'running' },
      ]),
    ).toBe(true);
    expect(
      hasAssistantAnswerText([
        { type: 'thinking', text: '', streaming: true },
        { type: 'text', text: '   ' },
      ]),
    ).toBe(false);
  });
});
