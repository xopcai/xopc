import { describe, expect, it } from 'vitest';

import { formatIntervalMsLabel } from '@/features/scheduling/interval/format-interval-label';

const presets = {
  custom: 'Custom',
  every30s: 'Every 30 seconds',
  every1min: 'Every minute',
  every5min: 'Every 5 minutes',
  every10min: 'Every 10 minutes',
  every15min: 'Every 15 minutes',
  every30min: 'Every 30 minutes',
  every1h: 'Every hour',
  every2h: 'Every 2 hours',
};

describe('formatIntervalMsLabel', () => {
  it('returns preset phrase when presets match a known heartbeat interval', () => {
    expect(formatIntervalMsLabel(60_000, 'en-US', presets)).toBe('Every minute');
  });

  it('formats non-preset intervals with Intl units', () => {
    const label = formatIntervalMsLabel(180_000, 'en-US');
    expect(label).toMatch(/minute/i);
  });

  it('clamps sub-second values to at least one second', () => {
    const label = formatIntervalMsLabel(500, 'en-US');
    expect(label).toMatch(/second/i);
  });
});
