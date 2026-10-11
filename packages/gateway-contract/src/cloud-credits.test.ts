import { describe, expect, it } from 'vitest';
import { creditDecimal, parseCreditDecimal } from './cloud-credits.js';

describe('Credit decimal boundary', () => {
  it('round-trips quantities without floating point rounding', () => {
    for (const micro of ['0', '1', '84320', '10000000', '9007199254740991']) {
      expect(parseCreditDecimal(creditDecimal(micro))).toBe(micro);
    }
    expect(creditDecimal('84320')).toBe('8.432');
  });
  it.each(['NaN', '-1', '1e4', '0.00001', '900719925475'])('rejects invalid quantities: %s', value => {
    expect(() => parseCreditDecimal(value)).toThrow();
  });
});
