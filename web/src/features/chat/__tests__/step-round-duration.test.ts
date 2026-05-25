import { describe, expect, it } from 'vitest';

import { formatStepRoundDuration } from '@/features/chat/time/step-round-duration';

describe('formatStepRoundDuration', () => {
  it('formats zh minutes and seconds', () => {
    expect(formatStepRoundDuration(236000, 'zh')).toBe('3分56秒');
    expect(formatStepRoundDuration(60000, 'zh')).toBe('1分');
    expect(formatStepRoundDuration(45000, 'zh')).toBe('45秒');
  });

  it('formats en minutes and seconds', () => {
    expect(formatStepRoundDuration(236000, 'en')).toBe('3m 56s');
    expect(formatStepRoundDuration(60000, 'en')).toBe('1m');
    expect(formatStepRoundDuration(45000, 'en')).toBe('45s');
  });

  it('handles sub-second', () => {
    expect(formatStepRoundDuration(400, 'zh')).toBe('不到1秒');
    expect(formatStepRoundDuration(400, 'en')).toBe('<1s');
  });
});
