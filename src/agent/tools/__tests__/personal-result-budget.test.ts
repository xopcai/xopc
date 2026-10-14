import { describe, expect, it } from 'vitest';

import { LOCAL_READ_MAX_CHARS } from '../local-read-budget.js';
import { boundedPersonalResult } from '../personal-result-budget.js';

describe('personal read output budget', () => {
  it('keeps pagination aligned with the items actually returned', () => {
    const value = boundedPersonalResult({ offset: 20, total: 100,
      items: Array.from({ length: 20 }, (_, index) => ({ id: String(index), text: 'x'.repeat(1000) })) }) as any;
    expect(JSON.stringify(value).length).toBeLessThanOrEqual(LOCAL_READ_MAX_CHARS);
    expect(value.items.length).toBeGreaterThan(0);
    expect(value.nextOffset).toBe(20 + value.items.length);
    expect(value.truncated).toBe(true);
  });

  it('does not advertise another page solely because a field was shortened', () => {
    const value = boundedPersonalResult({ offset: 0, total: 1, items: [{ id: 'item', text: 'x'.repeat(1000) }] }) as any;
    expect(value).not.toHaveProperty('nextOffset');
    expect(value.truncated).toBe(true);
  });

  it('discloses incomplete details without exceeding the output budget', () => {
    const value = boundedPersonalResult({ id: 'object', body: 'x'.repeat(2000) }) as any;
    expect(value).toMatchObject({ id: 'object', truncated: true, requiresSpecialist: true });
    expect(JSON.stringify(value).length).toBeLessThanOrEqual(LOCAL_READ_MAX_CHARS);
  });
});
