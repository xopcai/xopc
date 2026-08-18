import { describe, expect, it } from 'vitest';

import type { ConnectorDefinition } from '../../connectors/types.js';
import { buildOutcomeSourceRecommendations } from '../source-recommendations.js';

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

describe('outcome source recommendations', () => {
  it('matches Chinese outcome intent to an available source and excludes installed sources', () => {
    const definitions = [
      source('calendar', 'Calendar', 'Meetings, schedules, and events'),
      source('mail', 'Email', 'Mail and inbox context'),
    ];
    const outcomes = [{ id: 'outcome-1', objective: '安排下周的客户会议' }];

    expect(buildOutcomeSourceRecommendations(definitions, new Set(), outcomes)).toMatchObject([
      { sourceId: 'calendar', outcomeId: 'outcome-1' },
    ]);
    expect(buildOutcomeSourceRecommendations(definitions, new Set(['calendar']), outcomes)).toEqual([]);
  });
});
