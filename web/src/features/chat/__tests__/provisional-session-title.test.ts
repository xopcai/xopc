import { describe, expect, it } from 'vitest';

import { provisionalTitleFromUserText } from '@/lib/provisional-session-title';

describe('provisionalTitleFromUserText (web)', () => {
  it('uses first line of user text', () => {
    expect(provisionalTitleFromUserText('Plan a trip\nDetails here')).toBe('Plan a trip');
  });

  it('strips envelope timestamp prefix', () => {
    expect(provisionalTitleFromUserText('[2026-01-15 10:00 UTC] Hello')).toBe('Hello');
  });

  it('uses skill arguments instead of the expanded skill header', () => {
    expect(
      provisionalTitleFromUserText(
        [
          '',
          '## Skill: hatch-pet',
          '',
          'Create animated pets.',
          '',
          '# Hatch Pet',
          '',
          '**Arguments**: make a tiny space rover pet',
        ].join('\n'),
      ),
    ).toBe('make a tiny space rover pet');
  });

  it('uses raw skill command arguments when present', () => {
    expect(provisionalTitleFromUserText('/skill:hatch-pet make a tiny space rover pet')).toBe(
      'make a tiny space rover pet',
    );
  });
});
