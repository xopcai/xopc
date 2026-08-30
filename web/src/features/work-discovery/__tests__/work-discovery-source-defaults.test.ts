import { describe, expect, it } from 'vitest';

import type { ElectronUnderstandingSourceDefinition } from '@/types/electron';

import { defaultSelectedLocalSourceIds } from '../work-discovery-source-defaults';

function source(
  id: string,
  availability: ElectronUnderstandingSourceDefinition['availability'] = 'available',
): ElectronUnderstandingSourceDefinition {
  return {
    id,
    category: 'recent_documents',
    platform: 'all',
    displayName: id,
    description: '',
    availability,
    permission: 'not_requested',
    defaultAccessMode: 'once',
    supportedAccessModes: ['once'],
    recommended: false,
    sensitive: true,
  };
}

describe('defaultSelectedLocalSourceIds', () => {
  it('selects every available onboarding source by default', () => {
    const selected = defaultSelectedLocalSourceIds([
      source('local-recent-files'),
      source('chromium-bookmarks'),
      source('apple-notes'),
      source('apple-mail'),
      source('apple-calendar'),
      source('apple-reminders'),
    ]);

    expect([...selected]).toEqual([
      'local-recent-files',
      'chromium-bookmarks',
      'apple-notes',
      'apple-mail',
      'apple-calendar',
      'apple-reminders',
    ]);
  });

  it('does not select unavailable or unrelated sources', () => {
    const selected = defaultSelectedLocalSourceIds([
      source('apple-notes', 'unavailable'),
      source('some-future-source'),
    ]);

    expect([...selected]).toEqual([]);
  });
});
