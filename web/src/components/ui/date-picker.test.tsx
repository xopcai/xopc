import { describe, expect, it } from 'vitest';

import { parseDatePickerValue, toDatePickerValue } from '@/components/ui/date-picker';

describe('date picker value helpers', () => {
  it('round-trips a local calendar date without timezone drift', () => {
    const date = parseDatePickerValue('2026-08-25');

    expect(date).not.toBeNull();
    expect(toDatePickerValue(date!)).toBe('2026-08-25');
  });

  it('supports leap days and rejects impossible dates', () => {
    expect(toDatePickerValue(parseDatePickerValue('2028-02-29')!)).toBe('2028-02-29');
    expect(parseDatePickerValue('2027-02-29')).toBeNull();
    expect(parseDatePickerValue('2026-13-01')).toBeNull();
    expect(parseDatePickerValue('')).toBeNull();
  });
});
