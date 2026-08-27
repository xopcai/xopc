import { describe, expect, it } from 'vitest';

import { appendTranscriptWithoutOverlap } from '../transcript.js';

describe('appendTranscriptWithoutOverlap', () => {
  it('removes exact segment overlap', () => {
    expect(appendTranscriptWithoutOverlap('one two three', 'two three four')).toBe('one two three four');
  });

  it('removes overlap despite punctuation and whitespace differences', () => {
    expect(
      appendTranscriptWithoutOverlap('今天讨论产品稳定性。', '产品稳定性，下一步优化录音。'),
    ).toBe('今天讨论产品稳定性。下一步优化录音。');
  });

  it('keeps unrelated segments separated', () => {
    expect(appendTranscriptWithoutOverlap('first topic', 'second topic')).toBe('first topic\nsecond topic');
  });
});
