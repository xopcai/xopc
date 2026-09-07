import { describe, expect, it } from 'vitest';

import {
  assistantTextForDisplay,
  getAssistantFinalResultText,
} from '../assistant-text-presentation';
import { appendTextDelta, finishTextSegment } from '../streaming';
import type { MessageContent } from '../messages.types';
import { parseSessionMessages } from '../session-message-parser';

describe('assistant text presentation', () => {
  it('keeps narration concise like WebUI', () => {
    expect(assistantTextForDisplay({
      type: 'text',
      text: '我先检查项目。后续过程不应作为第二个答案展示。',
      presentation: 'narration',
    })).toBe('我先检查项目。');
  });

  it('renders every pending delta before the segment ends without exposing it to TTS', () => {
    const content: MessageContent[] = [];
    const chunks = ['第一句。', '第二句正在输出。', '后面还有内容。'.repeat(30)];
    let expected = '';
    for (const delta of chunks) {
      appendTextDelta(content, delta, 'segment-1');
      expected += delta;
      const block = content[0];
      if (block.type !== 'text') throw new Error('Expected text');
      expect(assistantTextForDisplay(block)).toBe(expected);
      expect(getAssistantFinalResultText(content)).toBe('');
    }
    finishTextSegment(content, 'segment-1', 'answer');
    const block = content[0];
    if (block.type !== 'text') throw new Error('Expected text');
    expect(assistantTextForDisplay(block)).toBe(expected);
    expect(getAssistantFinalResultText(content)).toBe(expected);
  });

  it('reads only explicit final answer segments', () => {
    expect(getAssistantFinalResultText([
      { type: 'text', text: 'I will inspect the files.', presentation: 'narration' },
      { type: 'tool_use', id: 'tool-1', name: 'read_file', status: 'done' },
      { type: 'text', text: 'The final result.', presentation: 'answer' },
    ])).toBe('The final result.');
  });

  it('uses text after the last activity for older stored turns', () => {
    expect(getAssistantFinalResultText([
      { type: 'text', text: 'Checking now.' },
      { type: 'thinking', text: 'analysis' },
      { type: 'tool_use', id: 'tool-1', name: 'read_file', status: 'done' },
      { type: 'text', text: 'Finished successfully.' },
    ])).toBe('Finished successfully.');
  });

  it('preserves narration and answer boundaries after history reload', () => {
    const [message] = parseSessionMessages([
      {
        role: 'assistant',
        content: 'I will inspect the files.',
        rawContent: [
          { type: 'text', text: 'I will inspect the files.' },
          { type: 'tool_use', id: 'tool-1', name: 'read_file', status: 'done' },
        ],
      },
      {
        role: 'assistant',
        content: 'The final result.',
        rawContent: [{ type: 'text', text: 'The final result.' }],
      },
    ]);

    expect(message.content).toEqual(expect.arrayContaining([
      expect.objectContaining({ text: 'I will inspect the files.', presentation: 'narration' }),
      expect.objectContaining({ text: 'The final result.', presentation: 'answer' }),
    ]));
    expect(getAssistantFinalResultText(message.content)).toBe('The final result.');
  });
});
