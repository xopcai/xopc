import { describe, expect, it } from 'vitest';

import { modelResponseMetadata } from '../../../scripts/phone-apps-live/response-metadata.js';

const payload = (content: unknown, extras: Record<string, unknown> = {}) => ({
  choices: [{ finish_reason: 'stop', message: { content, reasoning_content: 'private internal reasoning' } }], ...extras,
});

describe('phone model response metadata', () => {
  it('returns only counts and fixed labels without raw model reasoning, action arguments or secrets', () => {
    const secret = 'secret-api-key-and-private-query';
    const result = modelResponseMetadata(payload(`<think>${secret}</think><answer>do(action="Type", text="${secret}")</answer>`, {
      usage: { prompt_tokens: 30, completion_tokens: 40, total_tokens: 70, completion_tokens_details: { reasoning_tokens: 25, secret } },
      headers: { Authorization: `Bearer ${secret}` }, error: { message: secret },
    }));
    expect(result).toMatchObject({ finishReason: 'stop', hasThink: true, hasAnswer: true, finalFormat: 'think-literal',
      usage: { promptTokens: 30, completionTokens: 40, totalTokens: 70, reasoningTokens: 25 } });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/secret-api-key|private-query|private internal reasoning|Authorization|Bearer|do\(|Type/);
  });

  it.each([
    ['do(action="Tap", element=[100,200])', 'literal'],
    ['finish(message="private answer")', 'literal'],
    ['<think>private</think>\ndo(action="Back")', 'think-literal'],
    ['Private preamble\nfinish(message="private")', 'think-literal'],
    ['<answer>do(action="Home")</answer>', 'think-literal'],
    ['```python\ndo(action="Back")\n```', 'fenced'],
    ['{"kind":"complete","summary":"private"}', 'json'],
    ['<think>private</think><answer>```python\ndo(action="Back")\n```</answer>', 'fenced'],
    ['<think>private</think>\n{"kind":"complete"}', 'json'],
    ['<answer>{"kind":"complete"}</answer>', 'json'],
    ['[1,2,3]', 'json'],
    ['{"kind":', 'other'],
    ['Unstructured private prose', 'other'],
  ])('classifies the output envelope without returning its content (%s)', (content, expected) => {
    expect(modelResponseMetadata(payload(content)).finalFormat).toBe(expected);
  });

  it('reports repeated-line counts and lengths without retaining repeated private text', () => {
    const line = 'private repeated reasoning and arguments';
    const result = modelResponseMetadata(payload(`${line}\n${line}\nunique\n${line}`));
    expect(result.repetition).toEqual({ analyzedLines: 4, repeatedLines: 2, repeatedLineRatio: 0.5, longestRepeatedLineChars: line.length });
    expect(JSON.stringify(result)).not.toContain(line);
  });

  it('bounds analysis of unusually large responses and ignores arbitrary provider fields', () => {
    const content = Array.from({ length: 5000 }, () => 'private raw content').join('\n');
    const result = modelResponseMetadata(payload(content, { provider_debug: 'private provider debug' }));
    expect(result.analysisTruncated).toBe(true);
    expect(result.outputChars).toBe(content.length);
    expect(result.repetition.analyzedLines).toBeLessThanOrEqual(2048);
    expect(JSON.stringify(result).length).toBeLessThan(700);
    expect(JSON.stringify(result)).not.toMatch(/private raw|private provider/);
  });

  it.each([null, undefined, [], 'private payload', { choices: null }, { choices: [null] }, payload(null)])('handles absent or malformed response bodies', value => {
    expect(modelResponseMetadata(value)).toMatchObject({ outputChars: 0, hasThink: false, hasAnswer: false,
      finalFormat: 'other', repetition: { analyzedLines: 0, repeatedLineRatio: 0 }, analysisTruncated: false });
  });

  it('normalizes unknown finish reasons and rejects nonnumeric or excessive token counts', () => {
    const result = modelResponseMetadata({ choices: [{ finish_reason: 'private provider failure', message: { content: '' } }], usage: {
      prompt_tokens: 'private token counter', completion_tokens: -1, total_tokens: Infinity,
      completion_tokens_details: { reasoning_tokens: 1_000_000_001 },
    } });
    expect(result.finishReason).toBe('other');
    expect(result.usage).toEqual({ promptTokens: undefined, completionTokens: undefined, totalTokens: undefined, reasoningTokens: undefined });
    expect(JSON.stringify(result)).not.toMatch(/private provider|private token/);
    expect(modelResponseMetadata({ choices: [{ finish_reason: null }] }).finishReason).toBeNull();
  });
});
