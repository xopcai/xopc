import { describe, expect, it, vi } from 'vitest';

import { classifyModelActionEnvelope } from '../../../scripts/phone-apps-live/protocol-envelope-diagnostics.js';

describe('private phone protocol envelope diagnostics', () => {
  it('identifies a prefixed parseable call without returning private content, arguments or validator results', () => {
    const secret = 'private-thought-api-key-and-query';
    const validate = vi.fn(() => ({ content: secret, error: secret }));
    const result = classifyModelActionEnvelope(`Private ${secret}\n答案：do(action="Type", text="${secret}")`, validate);
    expect(result).toMatchObject({ anyCallCount: 1, balancedLiteralCallCount: 1, validationAttempted: true,
      lastBalancedLiteralCallParseable: true, prefixCategory: 'explicitAnswerLabel', suffixCategory: 'whitespace', quoteKind: 'double' });
    expect(validate).toHaveBeenCalledOnce();
    expect(JSON.stringify(result)).not.toMatch(/private-thought|api-key|query|do\(|Type|答案/);
  });

  it.each([
    ['', 'none'],
    ['答案：', 'explicitAnswerLabel'],
    ['Answer: ', 'explicitAnswerLabel'],
    ['**Answer:** ', 'explicitAnswerLabel'],
    ['<answer>', 'explicitAnswerLabel'],
    ['```python\n', 'markdownFence'],
    ['<think>private rationale</think>\n', 'closingThink'],
    ['Private explanatory prose.\n', 'plainProse'],
  ])('classifies prefix %s into a fixed category', (prefix, expected) => {
    expect(classifyModelActionEnvelope(`${prefix}do(action="Back")`, () => true).prefixCategory).toBe(expected);
  });

  it.each([
    ['\n ', 'whitespace'],
    ['\n```', 'closingFence'],
    ['</answer>', 'closingAnswer'],
    ['。', 'punctuation'],
    [';!', 'punctuation'],
    [' private provider explanation', 'other'],
  ])('classifies suffix %s without exposing it', (suffix, expected) => {
    expect(classifyModelActionEnvelope(`do(action="Back")${suffix}`, () => true).suffixCategory).toBe(expected);
  });

  it('respects quoted parentheses and escaped quotes while counting lexical markers separately', () => {
    const literal = 'do(action="Type", text="a ) ( finish( \\"quoted\\" \\\\ path")';
    const validate = vi.fn(() => true);
    const result = classifyModelActionEnvelope(`答案：${literal}。`, validate);
    expect(result).toMatchObject({ anyCallCount: 2, balancedLiteralCallCount: 1, lastBalancedLiteralCallParseable: true,
      suffixCategory: 'punctuation', quoteKind: 'double' });
    expect(validate).toHaveBeenCalledWith(literal);
  });

  it('validates only the last balanced standalone call, not one nested in an invalid action argument', () => {
    const validate = vi.fn(() => false);
    const result = classifyModelActionEnvelope('do(action=finish(message="private"))', validate);
    expect(result).toMatchObject({ anyCallCount: 2, balancedLiteralCallCount: 1, lastBalancedLiteralCallParseable: false });
    expect(validate).toHaveBeenCalledWith('do(action=finish(message="private"))');
  });

  it('reports multiple calls but invokes the validator only for the last one', () => {
    const validate = vi.fn(() => true);
    const result = classifyModelActionEnvelope('do(action="Back")\nfinish(message="private final")', validate);
    expect(result).toMatchObject({ anyCallCount: 2, balancedLiteralCallCount: 2, lastBalancedLiteralCallParseable: true });
    expect(validate).toHaveBeenCalledOnce();
    expect(validate).toHaveBeenCalledWith('finish(message="private final")');
  });

  it.each(['答案：do(action="Type", text="private unfinished', 'finish(message="private"', 'plain private text'])('does not validate unbalanced calls or plain text', raw => {
    const validate = vi.fn();
    expect(classifyModelActionEnvelope(raw, validate)).toMatchObject({ balancedLiteralCallCount: 0,
      validationAttempted: false, lastBalancedLiteralCallParseable: false });
    expect(validate).not.toHaveBeenCalled();
  });

  it('does not leak validator exceptions or unknown prefixes', () => {
    const result = classifyModelActionEnvelope('private-provider-label: do(action="Unknown")', () => { throw new Error('private API key in error'); });
    expect(result).toMatchObject({ prefixCategory: 'plainProse', lastBalancedLiteralCallParseable: false });
    expect(JSON.stringify(result)).not.toMatch(/private|Unknown|error|key/);
  });

  it('reports mixed quote delimiters without returning literal values', () => {
    expect(classifyModelActionEnvelope('do(action=\'Type\', text="private")', () => true).quoteKind).toBe('mixed');
    expect(classifyModelActionEnvelope('do(action=\'Back\')', () => true).quoteKind).toBe('single');
    expect(classifyModelActionEnvelope('do(action=123)', () => true).quoteKind).toBe('none');
  });

  it('bounds malformed and oversized inputs without validating text outside the scan window', () => {
    const validate = vi.fn();
    const result = classifyModelActionEnvelope('private '.repeat(20_000) + 'do(action="Back")', validate);
    expect(result).toMatchObject({ analyzedChars: 65_536, scanTruncated: true, anyCallCount: 0, validationAttempted: false });
    expect(JSON.stringify(result).length).toBeLessThan(500);
    expect(JSON.stringify(result)).not.toContain('private');
    expect(validate).not.toHaveBeenCalled();
  });
});
