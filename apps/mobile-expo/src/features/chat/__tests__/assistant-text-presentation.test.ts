import { describe, expect, it } from 'vitest';

import {
  assistantTextForDisplay,
  getAssistantFinalResultText,
} from '../assistant-text-presentation';
import { parseSessionMessages } from '../session-message-parser';

describe('assistant text presentation', () => {
  it('keeps narration concise like WebUI', () => {
    expect(assistantTextForDisplay({
      type: 'text',
      text: '我先检查项目。后续过程不应作为第二个答案展示。',
      presentation: 'narration',
    })).toBe('我先检查项目。');
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
