import { describe, expect, it } from 'vitest';

import { formatStepRoundDuration } from '../step-round-duration';

describe('formatStepRoundDuration', () => {
  it('formats sub-second durations', () => {
    expect(formatStepRoundDuration(0, 'en')).toBe('<1s');
    expect(formatStepRoundDuration(500, 'zh')).toBe('不到1秒');
  });

  it('formats seconds and minutes in English', () => {
    expect(formatStepRoundDuration(5000, 'en')).toBe('5s');
    expect(formatStepRoundDuration(65000, 'en')).toBe('1m 5s');
    expect(formatStepRoundDuration(120000, 'en')).toBe('2m');
  });

  it('formats seconds and minutes in Chinese', () => {
    expect(formatStepRoundDuration(5000, 'zh')).toBe('5秒');
    expect(formatStepRoundDuration(65000, 'zh')).toBe('1分5秒');
    expect(formatStepRoundDuration(120000, 'zh')).toBe('2分');
  });
});
