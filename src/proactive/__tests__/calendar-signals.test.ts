import { describe, expect, it } from 'vitest';

import type { KnowledgeSourceItem } from '../../knowledge/types.js';
import { buildFocusCalendarSignals } from '../calendar-signals.js';
import type { FocusView } from '../types.js';

describe('buildFocusCalendarSignals', () => {
  const now = Date.parse('2026-08-02T08:00:00.000Z');
  const focus: FocusView = {
    id: 'focus-1',
    title: 'Desktop release',
    summary: 'Package and validate the xopc desktop release.',
    status: 'active',
    horizon: 'current',
    confidence: 0.9,
    focusScore: 90,
    userStatus: 'confirmed',
    projectIds: [],
    watches: [],
    lastObservedAt: now,
  };

  it('matches an upcoming calendar event to a confirmed focus', () => {
    const signals = buildFocusCalendarSignals([
      item('event-1', {
        title: 'xopc desktop release review',
        description: 'Review packaging evidence and sign-off.',
        start: { dateTime: '2026-08-03T09:00:00.000Z' },
        end: { dateTime: '2026-08-03T10:00:00.000Z' },
      }),
    ], [focus], now);

    expect(signals).toEqual([expect.objectContaining({
      id: 'event-1',
      focusId: 'focus-1',
      title: 'xopc desktop release review',
      startsAt: Date.parse('2026-08-03T09:00:00.000Z'),
    })]);
  });

  it('ignores unrelated, past, and non-calendar items', () => {
    expect(buildFocusCalendarSignals([
      item('unrelated', { title: 'Dentist', start: '2026-08-03T09:00:00.000Z' }),
      item('past', { title: 'Desktop release', start: '2026-08-01T09:00:00.000Z' }),
      { ...item('email', { title: 'Desktop release', start: '2026-08-03T09:00:00.000Z' }), itemType: 'email' },
    ], [focus], now)).toEqual([]);
  });

  it('deduplicates the same event imported from two calendar sources', () => {
    const payload = { title: 'xopc desktop release review', start: '2026-08-03T09:00:00.000Z' };
    expect(buildFocusCalendarSignals([
      item('desktop-event', payload),
      { ...item('google-event', payload), sourceInstanceId: 'composio-googlecalendar' },
    ], [focus], now)).toHaveLength(1);
  });

  function item(id: string, payload: unknown): KnowledgeSourceItem {
    return {
      id,
      sourceInstanceId: 'desktop:calendar',
      externalId: id,
      itemType: 'calendar_event',
      contentHash: id,
      normalizedText: JSON.stringify(payload),
      metadata: {},
      sensitivity: 'personal',
      retentionClass: 'bounded',
      synthesisPipeline: 'user_understanding',
      synthesisStatus: 'ignored',
      synthesisAttempts: 0,
      createdAt: '2026-08-02T08:00:00.000Z',
      updatedAt: '2026-08-02T08:00:00.000Z',
    };
  }
});
