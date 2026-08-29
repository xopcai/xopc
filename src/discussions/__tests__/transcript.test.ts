import { describe, expect, it } from 'vitest';

import { appendSequentialTranscript, appendTranscriptWithoutOverlap } from '../transcript.js';

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

  it('preserves word spacing, currency, and symbols after an overlap', () => {
    expect(appendTranscriptWithoutOverlap(
      'Budget is approved.',
      'approved. €5 million',
    )).toBe('Budget is approved. €5 million');
    expect(appendTranscriptWithoutOverlap(
      'All systems ready!',
      'systems ready! ✅ Proceed now',
    )).toBe('All systems ready! ✅ Proceed now');
  });

  it('does not de-duplicate adjacent audio chunks without overlap', () => {
    expect(appendSequentialTranscript(
      'We selected Project Alpha.',
      'Alpha is the final choice.',
    )).toBe('We selected Project Alpha.\nAlpha is the final choice.');
  });
});
