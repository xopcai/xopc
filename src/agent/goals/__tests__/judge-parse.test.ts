import { describe, expect, it } from 'vitest';

import {
  extractAssistantText,
  getAssistantMessageErrorReason,
  parseJudgeResponseFailOpen,
  stripCodeFences,
} from '../judge.js';

describe('stripCodeFences', () => {
  it('strips ```json ... ``` wrapping', () => {
    const input = '```json\n{"done": true, "reason": "ok"}\n```';
    expect(stripCodeFences(input)).toBe('{"done": true, "reason": "ok"}');
  });

  it('strips ``` ... ``` without language tag', () => {
    const input = '```\n{"done": false}\n```';
    expect(stripCodeFences(input)).toBe('{"done": false}');
  });

  it('strips closing ``` with trailing whitespace', () => {
    const input = '```json\n{"done": true}\n```  \n';
    expect(stripCodeFences(input)).toBe('{"done": true}');
  });

  it('returns plain JSON unchanged', () => {
    const input = '{"done": true, "reason": "shipped"}';
    expect(stripCodeFences(input)).toBe(input);
  });

  it('handles text before and after code fence (only strips fences)', () => {
    const input = 'Analysis:\n```json\n{"done": true}\n```\nDone.';
    // Opening fence is not at the start after trim, so no fence stripping
    expect(stripCodeFences(input)).toBe(input.trim());
  });

  it('handles empty string', () => {
    expect(stripCodeFences('')).toBe('');
    expect(stripCodeFences('   ')).toBe('');
  });

  it('strips quadruple backtick fences', () => {
    const input = '````json\n{"done": true}\n````';
    expect(stripCodeFences(input)).toBe('{"done": true}');
  });
});

describe('extractAssistantText', () => {
  it('extracts text from TextContent blocks', () => {
    const content = [{ type: 'text', text: '{"done": true}' }];
    expect(extractAssistantText(content)).toBe('{"done": true}');
  });

  it('concatenates multiple TextContent blocks', () => {
    const content = [
      { type: 'text', text: 'hello ' },
      { type: 'text', text: 'world' },
    ];
    expect(extractAssistantText(content)).toBe('hello world');
  });

  it('falls back to ThinkingContent when text blocks are empty', () => {
    const content = [
      { type: 'thinking', thinking: '{"done": false, "reason": "still working"}' },
    ];
    expect(extractAssistantText(content)).toBe('{"done": false, "reason": "still working"}');
  });

  it('falls back to ThinkingContent when text blocks contain only whitespace', () => {
    const content = [
      { type: 'thinking', thinking: 'analysis result: {"done": true}' },
      { type: 'text', text: '  ' },
    ];
    expect(extractAssistantText(content)).toBe('analysis result: {"done": true}');
  });

  it('prefers TextContent over ThinkingContent when text is non-empty', () => {
    const content = [
      { type: 'thinking', thinking: 'Let me analyze...' },
      { type: 'text', text: '{"done": true, "reason": "completed"}' },
    ];
    expect(extractAssistantText(content)).toBe('{"done": true, "reason": "completed"}');
  });

  it('reads thinking from .text field when .thinking is absent', () => {
    const content = [
      { type: 'thinking', text: 'fallback thinking text' },
    ];
    expect(extractAssistantText(content)).toBe('fallback thinking text');
  });

  it('ignores toolCall blocks', () => {
    const content = [
      { type: 'toolCall', id: '1', name: 'test', arguments: {} },
      { type: 'text', text: '{"done": true}' },
    ];
    expect(extractAssistantText(content)).toBe('{"done": true}');
  });

  it('returns empty string for non-array input', () => {
    expect(extractAssistantText(null)).toBe('');
    expect(extractAssistantText(undefined)).toBe('');
    expect(extractAssistantText('string')).toBe('');
  });

  it('returns empty string for empty array', () => {
    expect(extractAssistantText([])).toBe('');
  });

  it('handles empty text block with no thinking fallback', () => {
    const content = [{ type: 'text', text: '' }];
    expect(extractAssistantText(content)).toBe('');
  });
});

describe('getAssistantMessageErrorReason', () => {
  it('returns errorMessage when assistant message stopped with error', () => {
    const message = {
      role: 'assistant',
      content: [],
      stopReason: 'error',
      errorMessage: '401 Unauthorized',
    };
    expect(getAssistantMessageErrorReason(message)).toBe('401 Unauthorized');
  });

  it('returns fallback message for error stop without errorMessage', () => {
    const message = {
      role: 'assistant',
      content: [],
      stopReason: 'error',
    };
    expect(getAssistantMessageErrorReason(message)).toBe('Judge model call failed.');
  });

  it('returns null for normal assistant messages', () => {
    const message = {
      role: 'assistant',
      content: [{ type: 'text', text: '{"done": false}' }],
      stopReason: 'stop',
    };
    expect(getAssistantMessageErrorReason(message)).toBeNull();
  });
});

describe('parseJudgeResponseFailOpen', () => {
  it('parses plain JSON', () => {
    const result = parseJudgeResponseFailOpen('{"done": true, "reason": "shipped"}');
    expect(result).toEqual({ done: true, reason: 'shipped', parseFailed: false });
  });

  it('parses JSON wrapped in markdown code fence', () => {
    const result = parseJudgeResponseFailOpen('```json\n{"done": false, "reason": "working"}\n```');
    expect(result).toEqual({ done: false, reason: 'working', parseFailed: false });
  });

  it('parses JSON with preamble text before it', () => {
    const input = 'Based on my analysis:\n{"done": true, "reason": "complete"}';
    const result = parseJudgeResponseFailOpen(input);
    expect(result.done).toBe(true);
    expect(result.parseFailed).toBe(false);
  });

  it('handles done as string "true"', () => {
    const result = parseJudgeResponseFailOpen('{"done": "true", "reason": "ok"}');
    expect(result.done).toBe(true);
    expect(result.parseFailed).toBe(false);
  });

  it('handles done as string "yes"', () => {
    const result = parseJudgeResponseFailOpen('{"done": "yes", "reason": "ok"}');
    expect(result.done).toBe(true);
  });

  it('returns parseFailed for empty input', () => {
    expect(parseJudgeResponseFailOpen('')).toMatchObject({ parseFailed: true });
    expect(parseJudgeResponseFailOpen('  ')).toMatchObject({ parseFailed: true });
  });

  it('returns parseFailed for non-JSON text', () => {
    const result = parseJudgeResponseFailOpen('The agent is making progress.');
    expect(result.parseFailed).toBe(true);
  });

  it('returns parseFailed=false even without reason field', () => {
    const result = parseJudgeResponseFailOpen('{"done": false}');
    expect(result.done).toBe(false);
    expect(result.parseFailed).toBe(false);
    expect(result.reason).toBeTruthy(); // falls back to 'no reason provided'
  });
});
