import { describe, expect, it } from 'vitest';

import type { ConnectorDefinition } from '../../connectors/types.js';
import { buildGoalSourceRecommendations } from '../source-recommendations.js';

function source(id: string, displayName: string, description: string): ConnectorDefinition {
  return {
    id,
    version: '1',
    displayName,
    description,
    category: 'data',
    kind: 'memorySource',
    source: 'builtin',
    capabilities: ['context'],
    auth: { mode: 'none' },
    setup: {},
    runtime: { type: 'memorySource', sourceKind: id },
  };
}

describe('goal source recommendations', () => {
  it('matches Chinese goal intent to an available source and excludes installed sources', () => {
    const definitions = [
      source('calendar', 'Calendar', 'Meetings, schedules, and events'),
      source('mail', 'Email', 'Mail and inbox context'),
    ];
    const goals = [{ id: 'goal-1', title: '安排下周的客户会议' }];

    expect(buildGoalSourceRecommendations(definitions, new Set(), goals)).toMatchObject([
      { sourceId: 'calendar', goalId: 'goal-1' },
    ]);
    expect(buildGoalSourceRecommendations(definitions, new Set(['calendar']), goals)).toEqual([]);
  });
});
