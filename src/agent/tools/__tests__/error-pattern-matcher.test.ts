import { describe, expect, it } from 'vitest';

import { ErrorPatternMatcher } from '../error-pattern-matcher.js';

describe('tool error classification', () => {
  it('does not classify shell syntax failure as a timeout because of generic guidance or metadata', () => {
    const error = JSON.stringify({ content: [{ type: 'text', text:
      "/bin/sh: -c: line 0: syntax error near unexpected token (\nCommand: use non-interactive commands with clear timeouts" }],
    details: { timedOut: false, timeoutMs: 120000 } });
    const result = new ErrorPatternMatcher({ logMatches: false }).matchError(error);
    expect(result.pattern?.name).toBe('syntax-error');
    expect(result.shouldRetry).toBe(false);
  });

  it.each(['Command timed out after 30s', 'TimeoutError: request failed', 'connect ETIMEDOUT'])('recognizes a real timeout: %s', error => {
    expect(new ErrorPatternMatcher({ logMatches: false }).matchError(error).pattern?.name).toBe('timeout');
  });
});
