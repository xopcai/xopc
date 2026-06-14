import { describe, expect, it } from 'vitest';

import { provisionalTitleFromUserText } from '@/lib/provisional-session-title';

describe('provisionalTitleFromUserText (web)', () => {
  it('uses first line of user text', () => {
    expect(provisionalTitleFromUserText('Plan a trip\nDetails here')).toBe('Plan a trip');
  });

  it('strips envelope timestamp prefix', () => {
    expect(provisionalTitleFromUserText('[2026-01-15 10:00 UTC] Hello')).toBe('Hello');
  });
});
